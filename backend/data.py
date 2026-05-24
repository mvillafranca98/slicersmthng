"""Persistence for setlists and mix snapshots."""
import json
from pathlib import Path
from backend.config import get_storage

def _data_dir() -> Path:
    d = get_storage() / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d

def load_setlists() -> list:
    p = _data_dir() / "setlists.json"
    if not p.exists():
        return []
    with open(p) as f:
        return json.load(f)

def save_setlists(data: list) -> None:
    with open(_data_dir() / "setlists.json", "w") as f:
        json.dump(data, f, indent=2)

def load_snapshots() -> dict:
    """Returns { song_id: snapshot } (one latest snapshot per song)."""
    p = _data_dir() / "mix_snapshots.json"
    if not p.exists():
        return {}
    with open(p) as f:
        return json.load(f)

def save_snapshots(data: dict) -> None:
    with open(_data_dir() / "mix_snapshots.json", "w") as f:
        json.dump(data, f, indent=2)

def get_snapshot(song_id: str):
    return load_snapshots().get(song_id)

def set_snapshot(song_id: str, snapshot: dict) -> None:
    data = load_snapshots()
    data[song_id] = snapshot
    save_snapshots(data)

def load_notes() -> dict:
    p = _data_dir() / "song_notes.json"
    if not p.exists():
        return {}
    with open(p) as f:
        return json.load(f)

def save_notes(data: dict) -> None:
    with open(_data_dir() / "song_notes.json", "w") as f:
        json.dump(data, f, indent=2)
