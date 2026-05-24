"""Import job runner: download -> Replicate stem separation -> analyze -> song_meta."""
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

# Replicate model. We don't pin a version hash so the latest published
# version of cjwbw/demucs is used; pin to a sha256 here if you want to
# lock behavior across runs.
REPLICATE_MODEL = "cjwbw/demucs"


def run_import(
    job_id: str,
    youtube_url: str,
    model: str,
    audio_format: str,
    storage_root: Path,
    on_progress,
):
    """Run full pipeline; call on_progress(job_id, stage, percent, message)."""

    def progress(stage: str, percent: float, message: str = ""):
        if on_progress:
            on_progress(job_id, stage, percent, message)

    if not os.environ.get("REPLICATE_API_TOKEN"):
        raise RuntimeError(
            "REPLICATE_API_TOKEN is not set. Create one at "
            "https://replicate.com/account/api-tokens and export it before "
            "starting the server."
        )

    progress("validating", 0, "Validating URL...")
    import yt_dlp
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(youtube_url, download=False)
    if not info:
        raise ValueError("Could not get video info (age-restricted or region-blocked?).")
    title = info.get("title", "unknown")
    duration = info.get("duration") or 0
    artist = info.get("uploader") or info.get("channel") or "Unknown"
    thumbnail_url = info.get("thumbnail") or ""

    song_id = make_song_id(title)
    songs_root = storage_root / "songs"
    songs_root.mkdir(parents=True, exist_ok=True)
    song_dir = songs_root / song_id
    song_dir.mkdir(parents=True, exist_ok=True)
    stems_dir = song_dir / "stems"
    stems_dir.mkdir(exist_ok=True)

    progress("downloading", 10, "Downloading from YouTube...")
    audio_file = song_dir / "original_audio.wav"
    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "outtmpl": str(song_dir / "original_audio.%(ext)s"),
        "quiet": False,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([youtube_url])
    if not audio_file.exists():
        raise ValueError("No audio track found.")

    progress("uploading", 30, "Uploading to Replicate GPU...")
    import replicate

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
    duration_sec = analysis.get("duration") or duration

    thumb_path = song_dir / "thumbnail.jpg"
    if thumbnail_url and not thumb_path.exists():
        try:
            urllib.request.urlretrieve(thumbnail_url, thumb_path)
        except Exception:
            pass

    # Drop original WAV (cloud workflow doesn't need to keep it; saves ~50MB/song).
    try:
        audio_file.unlink()
    except OSError:
        pass

    stem_names = [p.stem for p in stems_dir.glob("*.*") if p.suffix.lower() in (".mp3", ".wav", ".flac")]
    meta = {
        "id": song_id,
        "title": title,
        "artist": artist,
        "duration": duration_sec,
        "bpm": bpm,
        "key": key,
        "chords": chords,
        "stems": stem_names or MODEL_STEMS.get(model, ["vocals", "drums", "bass", "other"]),
        "youtube_url": youtube_url,
        "model_used": model,
        "thumbnail_path": "thumbnail.jpg",
        "added_at": datetime.utcnow().isoformat() + "Z",
        "notes": "",
    }
    with open(song_dir / "song_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    progress("finalizing", 100, "Done.")
    return meta


def _materialize_replicate_output(output, stems_dir: Path, ext: str) -> list[Path]:
    """Download Replicate stem URLs to local stems_dir. Handles dict or list output."""
    saved: list[Path] = []

    # Replicate model returns a dict mapping stem name -> URL (most common shape
    # for cjwbw/demucs) or a list of URLs whose order matches the model's stems.
    if isinstance(output, dict):
        items = list(output.items())
    elif isinstance(output, (list, tuple)):
        items = [(f"stem_{i}", url) for i, url in enumerate(output)]
    else:
        return saved

    for name, url in items:
        if not isinstance(url, str) or not url.startswith("http"):
            # Replicate Python client sometimes returns FileOutput objects with .url()
            url = getattr(url, "url", lambda: None)()
            if not isinstance(url, str):
                continue
        stem_name = _normalize_stem_name(name, url)
        dest = stems_dir / f"{stem_name}.{ext}"
        urllib.request.urlretrieve(url, dest)
        saved.append(dest)

    return saved


def _normalize_stem_name(name: str, url: str) -> str:
    """Pick a clean stem name from the API output (dict key) or URL path."""
    lower = name.lower()
    for canonical in ("vocals", "drums", "bass", "guitar", "piano", "other"):
        if canonical in lower:
            return canonical
    tail = url.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
    for canonical in ("vocals", "drums", "bass", "guitar", "piano", "other"):
        if canonical in tail:
            return canonical
    return name or "other"
