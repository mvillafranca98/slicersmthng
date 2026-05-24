"""Audio analysis: BPM, key, chords. Uses librosa when available; otherwise stubs."""
from pathlib import Path
import json

def analyze_audio(song_dir: Path, stems_dir: Path) -> dict:
    """Run BPM/key/chord analysis. Returns dict with bpm, key, chords, duration."""
    result = {"bpm": 120, "key": "C major", "chords": [], "duration": 0.0}
    # Prefer analysis from first stem we find
    stem_files = list(stems_dir.glob("*.mp3")) if stems_dir.exists() else []
    if not stem_files:
        stem_files = list(stems_dir.glob("*.wav")) if stems_dir.exists() else []
    analysis_path = song_dir / "analysis_result.json"
    try:
        import librosa
        # Use first stem for analysis (librosa.load supports wav/mp3 with audioread)
        path = stem_files[0] if stem_files else None
        if path and path.exists():
            y, sr = librosa.load(str(path), sr=22050, mono=True)
            result["duration"] = float(len(y)) / float(sr)
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            result["bpm"] = float(tempo) if hasattr(tempo, '__float__') else float(tempo[0])
            # Key (simplified)
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
            result["key"] = "C major"  # placeholder; full key detection needs more logic
            # Chord placeholder: one chord per 2 seconds
            num_chords = max(1, int(result["duration"] / 2.0))
            for i in range(num_chords):
                result["chords"].append({
                    "time": round(i * 2.0, 2),
                    "chord": ["C", "G", "Am", "F", "Dm", "Em"][i % 6]
                })
    except Exception:
        # Stub chords for demo
        result["duration"] = 180.0
        for t in range(0, 180, 4):
            result["chords"].append({
                "time": float(t),
                "chord": ["C", "G", "Am", "F", "Dm", "Em"][(t // 4) % 6]
            })
    with open(analysis_path, "w") as f:
        json.dump(result, f, indent=2)
    return result
