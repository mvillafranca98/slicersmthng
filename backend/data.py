"""Persistence for setlists and mix snapshots.

Each save writes BOTH the local JSON (fast read) AND pushes a copy to R2
(survives Render's ephemeral-disk wipes on every restart). On Render the
disk is gone after 15 min of idleness; before this change, setlists +
snapshots + notes silently vanished. Now they hydrate from R2 at startup
(see backend.routes._hydrate_data_blobs_async)."""
import json
from pathlib import Path
from backend.config import get_storage
from backend.storage import save_data_blob_to_r2

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
    save_data_blob_to_r2("setlists.json", data)

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
    save_data_blob_to_r2("mix_snapshots.json", data)

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
    save_data_blob_to_r2("song_notes.json", data)
