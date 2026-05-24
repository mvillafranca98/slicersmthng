"""Shared utilities: sanitization, song id, paths."""
import re
import uuid
from pathlib import Path

def sanitize_filename(name: str, max_len: int = 200) -> str:
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    return name.strip()[:max_len]

def make_song_id(title: str) -> str:
    slug = re.sub(r'[^a-zA-Z0-9]+', '_', title).strip('_').lower()[:80]
    short = uuid.uuid4().hex[:8]
    return f"{slug}_{short}" if slug else short

def get_song_dir(storage_root: Path, song_id: str) -> Path:
    return storage_root / "songs" / song_id
