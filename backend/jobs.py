"""Import job runner: (YouTube or uploaded file) -> Replicate -> analyze -> song_meta."""
import base64
import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path

from backend.utils import make_song_id
from backend.analysis import analyze_audio

# Demucs stem names per model (PRD)
MODEL_STEMS = {
    "htdemucs": ["vocals", "drums", "bass", "other"],
    "htdemucs_ft": ["vocals", "drums", "bass", "other"],
    "htdemucs_6s": ["vocals", "drums", "bass", "guitar", "piano", "other"],
}

REPLICATE_MODEL = "cjwbw/demucs"

# Path where we materialize YouTube cookies (Netscape format) from env.
COOKIES_PATH = Path("/tmp/yt_dlp_cookies.txt")


# ---------------------------------------------------------------------------
# YouTube helpers — try to evade datacenter-IP bot detection.
# ---------------------------------------------------------------------------

def _materialize_cookies() -> Path | None:
    """If YT_DLP_COOKIES_B64 is set, decode it to a local file and return the path.

    The env var must contain base64-encoded Netscape-format cookies (the format
    the 'Get cookies.txt LOCALLY' Chrome extension exports). YouTube treats a
    request with valid logged-in cookies as a real browser session and skips the
    'Sign in to confirm you're not a bot' interstitial that hits datacenter IPs.
    """
    b64 = os.environ.get("YT_DLP_COOKIES_B64", "").strip()
    if not b64:
        path_env = os.environ.get("YT_DLP_COOKIES_FILE", "").strip()
        return Path(path_env) if path_env and Path(path_env).exists() else None
    try:
        cookies = base64.b64decode(b64).decode("utf-8")
        COOKIES_PATH.write_text(cookies)
        return COOKIES_PATH
    except Exception:
        return None


def _yt_dlp_opts(extra: dict | None = None) -> dict:
    """Build yt-dlp opts with our anti-bot defaults applied."""
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        # Mobile-web client FIRST: YouTube treats mobile sessions more leniently
        # than desktop web for unfamiliar IPs (mobile-user pattern is harder to
        # flag as a bot). Fall back to desktop variants if mweb doesn't return
        # the requested formats.
        "extractor_args": {
            "youtube": {
                "player_client": ["mweb", "web", "web_safari"],
            }
        },
        # iPhone-Safari UA so the mweb client looks plausible.
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
                "Mobile/15E148 Safari/604.1"
            ),
        },
    }

    cookies = _materialize_cookies()
    if cookies:
        opts["cookiefile"] = str(cookies)

    # Optional HTTP/HTTPS/SOCKS proxy. Most reliable bypass for cloud IPs:
    # pass a residential-proxy URL like
    #   YT_DLP_PROXY=http://user:pass@residential-proxy.example.com:8080
    proxy = os.environ.get("YT_DLP_PROXY", "").strip()
    if proxy:
        opts["proxy"] = proxy

    if extra:
        opts.update(extra)
    return opts


def _bypass_status() -> str:
    """Human-readable summary of which YouTube-bypass measures are active."""
    parts = []
    parts.append("cookies=" + ("yes" if _materialize_cookies() else "no"))
    parts.append("proxy=" + ("yes" if os.environ.get("YT_DLP_PROXY", "").strip() else "no"))
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------

def run_import(
    job_id: str,
    youtube_url: str,
    model: str,
    audio_format: str,
    storage_root: Path,
    on_progress,
):
    """YouTube → stems via Replicate."""

    def progress(stage: str, percent: float, message: str = ""):
        if on_progress:
            on_progress(job_id, stage, percent, message)

    _require_replicate()

    progress("validating", 0, "Validating URL...")
    import yt_dlp
    try:
        with yt_dlp.YoutubeDL(_yt_dlp_opts()) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise RuntimeError(_friendly_ytdlp_error(str(e))) from e
    if not info:
        raise ValueError("Could not get video info (age-restricted or region-blocked?).")
    title = info.get("title", "unknown")
    duration = info.get("duration") or 0
    artist = info.get("uploader") or info.get("channel") or "Unknown"
    thumbnail_url = info.get("thumbnail") or ""

    song_id = make_song_id(title)
    song_dir, stems_dir = _make_song_dirs(storage_root, song_id)

    progress("downloading", 10, "Downloading from YouTube...")
    audio_file = song_dir / "original_audio.wav"
    download_opts = _yt_dlp_opts({
        # Permissive format chain: audio-only first, then any stream containing
        # audio, then the absolute best available. YouTube periodically gates
        # the audio-only formats; falling back to a combined stream lets the
        # FFmpegExtractAudio postprocessor still extract WAV from a video+audio
        # download. Avoids "Requested format is not available" errors.
        "format": "bestaudio/bestaudio*/best",
        "format_sort": ["acodec", "br"],
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "outtmpl": str(song_dir / "original_audio.%(ext)s"),
        "quiet": False,
    })
    try:
        with yt_dlp.YoutubeDL(download_opts) as ydl:
            ydl.download([youtube_url])
    except yt_dlp.utils.DownloadError as e:
        raise RuntimeError(_friendly_ytdlp_error(str(e))) from e
    if not audio_file.exists():
        raise ValueError("No audio track found.")

    return _process_audio_through_replicate(
        job_id=job_id,
        audio_file=audio_file,
        song_id=song_id,
        song_dir=song_dir,
        stems_dir=stems_dir,
        model=model,
        audio_format=audio_format,
        meta_overrides={
            "title": title,
            "artist": artist,
            "duration_hint": duration,
            "youtube_url": youtube_url,
            "thumbnail_url": thumbnail_url,
        },
        progress=progress,
    )


def run_import_file(
    job_id: str,
    uploaded_path: Path,
    original_filename: str,
    model: str,
    audio_format: str,
    storage_root: Path,
    on_progress,
):
    """Uploaded audio file → stems via Replicate (no YouTube involved)."""

    def progress(stage: str, percent: float, message: str = ""):
        if on_progress:
            on_progress(job_id, stage, percent, message)

    _require_replicate()

    if not uploaded_path.exists():
        raise ValueError("Upload missing or already cleaned up.")

    title = Path(original_filename).stem or "Uploaded track"
    song_id = make_song_id(title)
    song_dir, stems_dir = _make_song_dirs(storage_root, song_id)

    # Move the upload into the song dir for consistency with the YouTube path.
    audio_file = song_dir / ("original_audio" + uploaded_path.suffix.lower())
    uploaded_path.replace(audio_file)
    progress("downloading", 15, "Saved upload, sending to Replicate...")

    return _process_audio_through_replicate(
        job_id=job_id,
        audio_file=audio_file,
        song_id=song_id,
        song_dir=song_dir,
        stems_dir=stems_dir,
        model=model,
        audio_format=audio_format,
        meta_overrides={
            "title": title,
            "artist": "Uploaded",
            "duration_hint": 0,
            "youtube_url": "",
            "thumbnail_url": "",
        },
        progress=progress,
    )


# ---------------------------------------------------------------------------
# Shared post-download pipeline
# ---------------------------------------------------------------------------

def _process_audio_through_replicate(
    *,
    job_id: str,
    audio_file: Path,
    song_id: str,
    song_dir: Path,
    stems_dir: Path,
    model: str,
    audio_format: str,
    meta_overrides: dict,
    progress,
):
    import replicate

    progress("uploading", 30, "Uploading to Replicate GPU...")
    progress("separating", 40, "Running Demucs on Replicate GPU...")
    with open(audio_file, "rb") as f:
        output = replicate.run(
            REPLICATE_MODEL,
            input={
                "audio": f,
                "model": model if model in MODEL_STEMS else "htdemucs",
                "stem": "none",
                "shifts": 1,
                "overlap": 0.25,
                "mp3_bitrate": 320,
                "output_format": audio_format if audio_format in ("mp3", "flac") else "mp3",
            },
        )

    progress("organizing", 75, "Downloading stems...")
    ext = "mp3" if audio_format == "mp3" else "flac"
    stem_files = _materialize_replicate_output(output, stems_dir, ext)
    if not stem_files:
        raise RuntimeError(
            "Replicate returned no stem files. Output was: " + repr(output)[:300]
        )

    progress("analyzing", 85, "Analyzing BPM, key, chords...")
    analysis = analyze_audio(song_dir, stems_dir)
    bpm = analysis.get("bpm", 120)
    key = analysis.get("key", "C major")
    chords = analysis.get("chords", [])
    duration_sec = analysis.get("duration") or meta_overrides.get("duration_hint", 0)

    thumb_path = song_dir / "thumbnail.jpg"
    thumbnail_url = meta_overrides.get("thumbnail_url") or ""
    if thumbnail_url and not thumb_path.exists():
        try:
            urllib.request.urlretrieve(thumbnail_url, thumb_path)
        except Exception:
            pass

    # Drop the original audio to save disk on ephemeral hosts.
    try:
        audio_file.unlink()
    except OSError:
        pass

    stem_names = [
        p.stem for p in stems_dir.glob("*.*")
        if p.suffix.lower() in (".mp3", ".wav", ".flac")
    ]
    meta = {
        "id": song_id,
        "title": meta_overrides.get("title", "unknown"),
        "artist": meta_overrides.get("artist", "Unknown"),
        "duration": duration_sec,
        "bpm": bpm,
        "key": key,
        "chords": chords,
        "stems": stem_names or MODEL_STEMS.get(model, ["vocals", "drums", "bass", "other"]),
        "youtube_url": meta_overrides.get("youtube_url", ""),
        "model_used": model,
        "thumbnail_path": "thumbnail.jpg",
        "added_at": datetime.utcnow().isoformat() + "Z",
        "notes": "",
    }
    with open(song_dir / "song_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    progress("finalizing", 100, "Done.")
    return meta


def _make_song_dirs(storage_root: Path, song_id: str) -> tuple[Path, Path]:
    songs_root = storage_root / "songs"
    songs_root.mkdir(parents=True, exist_ok=True)
    song_dir = songs_root / song_id
    song_dir.mkdir(parents=True, exist_ok=True)
    stems_dir = song_dir / "stems"
    stems_dir.mkdir(exist_ok=True)
    return song_dir, stems_dir


def _require_replicate():
    if not os.environ.get("REPLICATE_API_TOKEN"):
        raise RuntimeError(
            "REPLICATE_API_TOKEN is not set. Create one at "
            "https://replicate.com/account/api-tokens and set it on the server."
        )


def _friendly_ytdlp_error(msg: str) -> str:
    """Turn yt-dlp's verbose errors into actionable hints."""
    low = msg.lower()
    status = _bypass_status()
    if "sign in to confirm you" in low or "not a bot" in low:
        return (
            f"YouTube is blocking this server's IP as a suspected bot ({status}). "
            "If cookies=yes here but it's still blocked, YouTube likely rejected them "
            "(geographic mismatch between cookie origin and server IP, or stale cookies). "
            "Best fixes: (a) set YT_DLP_PROXY to a residential proxy URL (~$3–5/mo), "
            "(b) re-export cookies from a fresh logged-in YouTube session, "
            "(c) upload the audio file directly via the upload button."
        )
    if "video unavailable" in low or "private" in low:
        return "This video is unavailable, private, or region-blocked."
    if "age" in low and "restrict" in low:
        return "This video is age-restricted. Try a different upload of the same song."
    if "requested format" in low:
        return (
            "YouTube didn't offer any downloadable audio format for this video. "
            f"({status}) — try a different upload, or use the file-upload button."
        )
    return msg


# ---------------------------------------------------------------------------
# Replicate output normalization (dict or list of URLs/FileOutput)
# ---------------------------------------------------------------------------

def _materialize_replicate_output(output, stems_dir: Path, ext: str) -> list[Path]:
    saved: list[Path] = []
    if isinstance(output, dict):
        items = list(output.items())
    elif isinstance(output, (list, tuple)):
        items = [(f"stem_{i}", url) for i, url in enumerate(output)]
    else:
        return saved

    for name, url in items:
        if not isinstance(url, str) or not url.startswith("http"):
            url = getattr(url, "url", lambda: None)()
            if not isinstance(url, str):
                continue
        stem_name = _normalize_stem_name(name, url)
        dest = stems_dir / f"{stem_name}.{ext}"
        urllib.request.urlretrieve(url, dest)
        saved.append(dest)

    return saved


def _normalize_stem_name(name: str, url: str) -> str:
    lower = name.lower()
    for canonical in ("vocals", "drums", "bass", "guitar", "piano", "other"):
        if canonical in lower:
            return canonical
    tail = url.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
    for canonical in ("vocals", "drums", "bass", "guitar", "piano", "other"):
        if canonical in tail:
            return canonical
    return name or "other"
