"""Audio analysis: BPM + duration. Lightweight by design — only the first 30 sec of audio,
mono at 22.05 kHz, just enough to estimate tempo. Skips heavy chroma/CQT calls that OOM
on small-CPU hosts.

Returns: {"bpm": float, "key": str, "chords": [...], "duration": float}.

If librosa is not installed, or analysis times out / errors, returns sensible defaults so the
import job still completes successfully (BPM is just metadata; the stems are the real product).

To skip analysis entirely, set env SLICR_SKIP_ANALYSIS=1.
"""
import json
import os
from pathlib import Path

DEFAULT_BPM = 120.0
DEFAULT_KEY = "C major"
# How many seconds of audio to analyze. librosa scales linearly with duration; capping at
# 30 sec keeps RAM <100 MB and CPU <10 sec on Render free tier.
ANALYSIS_WINDOW_SEC = 30
SAMPLE_RATE = 22050


def analyze_audio(song_dir: Path, stems_dir: Path) -> dict:
    result = {
        "bpm": DEFAULT_BPM,
        "key": DEFAULT_KEY,
        "chords": [],
        "duration": 0.0,
    }

    # Quick exit if analysis is disabled by env (useful for tests / lowest-resource hosts).
    if os.environ.get("SLICR_SKIP_ANALYSIS", "").strip() in ("1", "true", "yes"):
        _write(song_dir, result)
        return result

    stem_files = []
    if stems_dir.exists():
        for ext in ("mp3", "wav", "flac", "m4a"):
            stem_files.extend(stems_dir.glob(f"*.{ext}"))
    if not stem_files:
        _write(song_dir, result)
        return result

    # Prefer drums for BPM detection if present (most rhythmic stem).
    path = next((p for p in stem_files if p.stem.lower() == "drums"), stem_files[0])

    try:
        import librosa
        import numpy as np  # noqa: F401  (ensures numpy is loaded before librosa's lazy import)

        # Load only the first ANALYSIS_WINDOW_SEC seconds. librosa supports duration=...
        # to stream-decode just that window — avoids loading full 4-min audio into RAM.
        y, sr = librosa.load(
            str(path),
            sr=SAMPLE_RATE,
            mono=True,
            duration=ANALYSIS_WINDOW_SEC,
        )
        # Get full file duration via soundfile (fast metadata read, doesn't load audio).
        try:
            import soundfile as sf
            info = sf.info(str(path))
            result["duration"] = float(info.duration)
        except Exception:
            result["duration"] = float(len(y)) / float(sr)

        # Beat tracking is the only heavy lift; it's still fast on a 30-sec window.
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        # tempo may be ndarray or scalar depending on version.
        try:
            bpm = float(tempo)
        except (TypeError, ValueError):
            bpm = float(tempo[0]) if hasattr(tempo, '__len__') and len(tempo) else DEFAULT_BPM
        # Sanity clamp — librosa occasionally returns 0 or absurd values.
        result["bpm"] = bpm if 30 <= bpm <= 300 else DEFAULT_BPM

        # Key + chords intentionally left as defaults (real detection needs heavier models;
        # we'll wire that up as part of the chord-timeline task).
    except Exception as e:
        # Never block the import on analysis. Log to song dir for debugging.
        (song_dir / "analysis_error.txt").write_text(f"{type(e).__name__}: {e}")

    _write(song_dir, result)
    return result


def _write(song_dir: Path, result: dict) -> None:
    try:
        with open(song_dir / "analysis_result.json", "w") as f:
            json.dump(result, f, indent=2)
    except OSError:
        pass
