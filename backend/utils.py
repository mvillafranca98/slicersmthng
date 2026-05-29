"""Shared utilities: sanitization, song id, paths."""
import re
import uuid
from pathlib import Path
from flask import abort

# Strict allowlist matching the format make_song_id produces: lowercase
# alphanumeric + underscore, 1-100 chars. Anything else is rejected before
# it ever reaches the filesystem.
_SONG_ID_RE = re.compile(r'^[a-z0-9_]{1,100}$')
_STEM_NAME_RE = re.compile(r'^[a-z0-9_]{1,50}$')


def sanitize_filename(name: str, max_len: int = 200) -> str:
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    return name.strip()[:max_len]


def make_song_id(title: str) -> str:
    slug = re.sub(r'[^a-zA-Z0-9]+', '_', title).strip('_').lower()[:80]
    short = uuid.uuid4().hex[:8]
    return f"{slug}_{short}" if slug else short


def validate_song_id(song_id: str | None) -> str:
    """Return `song_id` unchanged if it matches the strict allowlist.

    Aborts the request with 400 otherwise. Blocks path-traversal via `..`,
    absolute paths, URL-encoded slashes, and anything else that doesn't look
    like an id produced by `make_song_id`.
    """
    if not song_id or not _SONG_ID_RE.match(song_id):
        abort(400, description="invalid song_id")
    return song_id


def validate_stem_name(stem_name: str | None) -> str:
    """Like `validate_song_id` but for stem names (vocals, drums, etc.)."""
    if not stem_name or not _STEM_NAME_RE.match(stem_name):
        abort(400, description="invalid stem_name")
    return stem_name


def get_song_dir(storage_root: Path, song_id: str) -> Path:
    # Defense-in-depth: even if a caller forgets the route-level validator,
    # this trip-wires the same protection at the filesystem boundary.
    song_id = validate_song_id(song_id)
    return storage_root / "songs" / song_id
