"""Import job runner: (YouTube or uploaded file) -> Replicate -> analyze -> song_meta."""
import base64
import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path

from backend.utils import make_song_id
from backend.analysis import analyze_audio
from backend.storage import save_song_meta

# Demucs stem names per model (PRD)
MODEL_STEMS = {
    "htdemucs": ["vocals", "drums", "bass", "other"],
    "htdemucs_ft": ["vocals", "drums", "bass", "other"],
    "htdemucs_6s": ["vocals", "drums", "bass", "guitar", "piano", "other"],
}

# Pinned to a specific version hash because unpinned "owner/model" calls
# sometimes 404 when Replicate's latest-version pointer goes stale for
# community models. Overridable via REPLICATE_MODEL env var so we can swap
# (e.g. "ryan5453/demucs:b26a4313b4d75983d60657f80dfa93b9beb354f6e4fa29ecd27ffe14d60117f6")
# without redeploying code.
DEFAULT_REPLICATE_MODEL = (
    "cjwbw/demucs:abf8fe28e407afa6d8e41e86a759caccc0af8e49c3c68016006b62cb0968441e"
)
REPLICATE_MODEL = os.environ.get("REPLICATE_MODEL", DEFAULT_REPLICATE_MODEL)

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

    _require_separator()

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

    return _process_audio_to_stems(
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

    _require_separator()

    if not uploaded_path.exists():
        raise ValueError("Upload missing or already cleaned up.")

    title = Path(original_filename).stem or "Uploaded track"
    song_id = make_song_id(title)
    song_dir, stems_dir = _make_song_dirs(storage_root, song_id)

    # Move the upload into the song dir for consistency with the YouTube path.
    audio_file = song_dir / ("original_audio" + uploaded_path.suffix.lower())
    uploaded_path.replace(audio_file)
    progress("downloading", 15, "Saved upload, sending to Replicate...")

    return _process_audio_to_stems(
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

def _process_audio_to_stems(
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
    """Run stem separation (Modal or Replicate per env) then analyze + finalize."""
    separator = _separator_name()
    if separator == "modal":
        sep = _separate_via_modal(audio_file, model, audio_format, stems_dir, song_id, progress)
    else:
        sep = _separate_via_replicate(audio_file, model, audio_format, stems_dir, song_id, progress)

    stem_files: list[Path] = sep.get("stem_files") or []
    stem_urls: dict[str, str] = sep.get("stem_urls") or {}
    if not stem_files and not stem_urls:
        raise RuntimeError(f"No stems were produced by the '{separator}' separator.")

    # If the separator already computed BPM + duration (Modal does), trust those
    # and skip the on-Render librosa call entirely. Way faster + avoids the
    # 0.5-CPU bottleneck on Render's free tier.
    bpm = sep.get("bpm")
    duration_sec = sep.get("duration") or meta_overrides.get("duration_hint", 0)
    if bpm is None or not duration_sec:
        progress("analyzing", 85, "Analyzing BPM on Render (slower fallback)...")
        analysis = analyze_audio(song_dir, stems_dir) if stem_files else {"bpm": 120, "duration": duration_sec}
        if bpm is None:
            bpm = analysis.get("bpm", 120)
        if not duration_sec:
            duration_sec = analysis.get("duration") or meta_overrides.get("duration_hint", 0)
    key = "C major"  # real key detection lands with the chord model migration
    chords: list = []

    thumb_path = song_dir / "thumbnail.jpg"
    thumbnail_url = meta_overrides.get("thumbnail_url") or ""
    if thumbnail_url and not thumb_path.exists():
        try:
            urllib.request.urlretrieve(thumbnail_url, thumb_path)
        except Exception:
            pass

    # Drop the original audio — we don't need it anymore. Either Modal kept the
    # stems on R2 (no local stems to compare against), or they live in stems_dir.
    try:
        audio_file.unlink()
    except OSError:
        pass

    if stem_urls:
        stem_names = list(stem_urls.keys())
    else:
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
        # stem_urls is the new field — present when stems live on R2 (or any
        # remote object store). When present, the stems endpoint redirects here.
        "stem_urls": stem_urls,
        "youtube_url": meta_overrides.get("youtube_url", ""),
        "model_used": model,
        "thumbnail_path": "thumbnail.jpg",
        "added_at": datetime.utcnow().isoformat() + "Z",
        "notes": "",
    }
    # Save locally AND push to R2 (so the song survives container restarts).
    save_song_meta(song_id, meta, song_dir / "song_meta.json")

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


def _separator_name() -> str:
    """Return 'modal' or 'replicate' depending on STEM_SEPARATOR env (default replicate)."""
    name = (os.environ.get("STEM_SEPARATOR") or "replicate").strip().lower()
    return "modal" if name == "modal" else "replicate"


def _require_separator():
    """Validate that the configured stem-separator has its required env wired up."""
    name = _separator_name()
    if name == "modal":
        if not os.environ.get("MODAL_DEMUCS_URL"):
            raise RuntimeError(
                "STEM_SEPARATOR=modal but MODAL_DEMUCS_URL is not set. Deploy the "
                "Modal function (see modal_demucs.py) and put its URL here."
            )
    else:
        if not os.environ.get("REPLICATE_API_TOKEN"):
            raise RuntimeError(
                "REPLICATE_API_TOKEN is not set. Create one at "
                "https://replicate.com/account/api-tokens — or set STEM_SEPARATOR=modal "
                "to use the free Modal path instead."
            )


def _separate_via_replicate(audio_file: Path, model: str, audio_format: str,
                             stems_dir: Path, song_id: str, progress) -> dict:
    """Stem separation via Replicate's hosted Demucs.

    Returns a dict shaped the same way as _separate_via_modal so the calling
    code is uniform regardless of which separator ran. Replicate always
    downloads stems to the local stems_dir (no R2 path here yet).
    """
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

    progress("organizing", 75, "Downloading stems from Replicate...")
    ext = "mp3" if audio_format == "mp3" else "flac"
    files = _materialize_replicate_output(output, stems_dir, ext)
    return {"stem_files": files, "stem_urls": {}, "bpm": None, "duration": None}


def _separate_via_modal(audio_file: Path, model: str, audio_format: str,
                         stems_dir: Path, song_id: str, progress) -> dict:
    """Stem separation via the self-deployed Modal function (modal_demucs.py).

    Returns a dict shaped like:
        {
          "stem_files": [Path, ...],   # local files (only in legacy base64 mode)
          "stem_urls": {name: url},    # populated when Modal uploaded to R2
          "bpm": float | None,         # Modal also runs librosa, since it has the audio
          "duration": float | None,
        }

    If R2 is wired up on Modal, audio uploads happen there directly and we
    just get back URLs — no 30 MB JSON round trip, no local file writes.
    """
    import urllib.error

    url = os.environ.get("MODAL_DEMUCS_URL", "").strip()
    if not url:
        raise RuntimeError("MODAL_DEMUCS_URL is not set on the server.")

    audio_b64 = base64.b64encode(audio_file.read_bytes()).decode("ascii")
    payload = json.dumps({
        "audio_b64": audio_b64,
        "model": model if model in MODEL_STEMS else "htdemucs",
        "format": audio_format if audio_format in ("mp3", "flac") else "mp3",
        "song_id": song_id,
    }).encode("utf-8")

    progress("uploading", 30, "Uploading to Modal GPU...")
    progress("separating", 40, "Running Demucs on Modal GPU (free tier)...")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=900) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"Modal endpoint HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Modal endpoint unreachable: {e}") from e

    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(f"Modal demucs error: {body['error']}")

    bpm = body.get("bpm") if isinstance(body, dict) else None
    duration = body.get("duration") if isinstance(body, dict) else None

    # ----- Path A: R2 URLs returned -----
    stems_urls = (body or {}).get("stems_urls") or {}
    if stems_urls:
        progress("organizing", 75, "Stems uploaded to R2 (no local copy needed)...")
        normalized = {_normalize_stem_name(name, url): url for name, url in stems_urls.items()}
        return {
            "stem_files": [],
            "stem_urls": normalized,
            "bpm": bpm,
            "duration": duration,
        }

    # ----- Path B: legacy base64 -----
    stems = (body or {}).get("stems") or {}
    if not stems:
        raise RuntimeError("Modal returned no stems in response.")

    progress("organizing", 75, "Decoding stems from Modal response...")
    ext = "mp3" if audio_format == "mp3" else "flac"
    saved: list[Path] = []
    for name, b64_data in stems.items():
        dest = stems_dir / f"{_normalize_stem_name(name, '')}.{ext}"
        dest.write_bytes(base64.b64decode(b64_data))
        saved.append(dest)
    return {
        "stem_files": saved,
        "stem_urls": {},
        "bpm": bpm,
        "duration": duration,
    }


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
