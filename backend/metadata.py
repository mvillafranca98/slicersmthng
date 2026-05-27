"""Title/artist enrichment via MusicBrainz.

Many user-uploaded files have wonky names — `R U Mine_.mp3`, the artist
in the title field, all-lowercase, with `(Official Audio)` or `[HD]` baked
in. MusicBrainz is the open-data music encyclopedia with a free fuzzy
search API; ~80% of "messy filename → real song" cases resolve first try
with no API key required.

Used in two places:
  1. backend/jobs.py — runs automatically on every new slice
  2. backend/routes.py /lyrics — runs before LRCLib search, so finding
     lyrics on an old badly-named song also fixes its metadata

License/etiquette note: MusicBrainz requires a User-Agent that identifies
your app + contact, and asks for max 1 request/sec from a single client.
Our usage is well under that.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import TypedDict


MB_BASE = "https://musicbrainz.org/ws/2"
MB_USER_AGENT = "SlicerSmthng/1.0 (https://slicersmthng.onrender.com)"
MIN_CONFIDENCE = 75  # 0-100; below this we keep the original strings


class EnrichedMeta(TypedDict):
    title: str
    artist: str
    source: str  # "musicbrainz" | "original"
    confidence: int  # 0-100, MusicBrainz's score for the top match


def _clean_for_search(s: str) -> str:
    """Strip noisy bits that MusicBrainz's fuzzy search trips on."""
    s = (s or "").strip()
    # Trailing " - Topic" (YouTube auto-generated artist channels)
    s = re.sub(r"\s*-\s*Topic\s*$", "", s, flags=re.I)
    # "(Official ...)" / "[Official ...]"
    s = re.sub(
        r"\s*[\(\[][^()\[\]]*(?:official|audio|video|lyric|hd|hq|mv|"
        r"remaster(?:ed)?|live|explicit|extended|radio\s*edit)[^()\[\]]*[\)\]]\s*",
        " ",
        s,
        flags=re.I,
    )
    # Underscores ("R U Mine_" → "R U Mine ") and other noisy filename chars
    s = s.replace("_", " ").replace("|", " ")
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def enrich_metadata(raw_title: str, raw_artist: str = "") -> EnrichedMeta:
    """Look up the song on MusicBrainz, return cleaned title + artist.

    Combines raw_title and raw_artist into a free-text search so things like
    swapped title/artist sort themselves out (MusicBrainz infers which token
    is which from its database).

    Returns the original strings unchanged if the top match isn't confident
    enough — we'd rather show a slightly-wrong name than a confidently-wrong
    one.
    """
    title_clean = _clean_for_search(raw_title)
    artist_clean = _clean_for_search(raw_artist) if raw_artist and raw_artist.lower() != "uploaded" else ""

    if not title_clean:
        return EnrichedMeta(title=raw_title, artist=raw_artist, source="original", confidence=0)

    search_terms = f"{title_clean} {artist_clean}".strip()
    qs = urllib.parse.urlencode({
        "query": search_terms,
        "fmt": "json",
        "limit": "5",
    })
    url = f"{MB_BASE}/recording/?{qs}"

    req = urllib.request.Request(
        url,
        headers={"User-Agent": MB_USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return EnrichedMeta(title=raw_title, artist=raw_artist, source="original", confidence=0)

    recordings = data.get("recordings") or []
    if not recordings:
        return EnrichedMeta(title=raw_title, artist=raw_artist, source="original", confidence=0)

    top = recordings[0]
    score = int(top.get("score") or 0)
    if score < MIN_CONFIDENCE:
        return EnrichedMeta(title=raw_title, artist=raw_artist, source="original", confidence=score)

    canonical_title = (top.get("title") or "").strip() or raw_title
    artist_credits = top.get("artist-credit") or []
    canonical_artist = ""
    for ac in artist_credits:
        # MusicBrainz uses a quirky join-phrase mechanism for "X feat. Y" etc.
        name = (ac.get("name") if isinstance(ac, dict) else "") or ""
        joinphrase = (ac.get("joinphrase") if isinstance(ac, dict) else "") or ""
        canonical_artist += name + joinphrase
    canonical_artist = canonical_artist.strip() or raw_artist

    return EnrichedMeta(
        title=canonical_title,
        artist=canonical_artist,
        source="musicbrainz",
        confidence=score,
    )
