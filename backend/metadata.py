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


def _search_variants(raw_title: str, raw_artist: str) -> list[str]:
    """Generate fallback search strings to try in order.

    Many sketchy y2mate-style filenames bury the real artist in parentheses
    ("Seven Nation Army (The White Stripes)"), making free-text search miss.
    We try multiple interpretations and pick the highest-confidence MB match.
    """
    title_clean = _clean_for_search(raw_title)
    artist_clean = _clean_for_search(raw_artist) if raw_artist and raw_artist.lower() != "uploaded" else ""

    variants: list[str] = []
    seen: set[str] = set()
    def add(q: str) -> None:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            variants.append(q)

    # 1) raw combination
    add(f"{title_clean} {artist_clean}")

    # 2) If title has "(X)", try parsing X as the artist hint
    paren_match = re.search(r"\(([^()]+)\)", title_clean)
    if paren_match:
        inner = paren_match.group(1).strip()
        outer = re.sub(r"\s*\([^()]+\)\s*", " ", title_clean).strip()
        add(f"{outer} {inner}")  # outer = title, inner = artist
        add(f"{inner} {outer}")  # inner = title, outer = artist
        add(outer)  # just the outer part

    # 3) Strip ALL parens content (fallback for weirdness)
    stripped = re.sub(r"\([^()]+\)|\[[^\[\]]+\]", " ", title_clean).strip()
    if stripped and stripped != title_clean:
        add(f"{stripped} {artist_clean}")
        add(stripped)

    # 4) Title alone (when artist info is junk like "y2mate" or "Topic")
    add(title_clean)

    return variants


def _query_musicbrainz(search_terms: str) -> EnrichedMeta | None:
    """Single MB query → top-match enriched meta (or None on failure / weak match)."""
    qs = urllib.parse.urlencode({"query": search_terms, "fmt": "json", "limit": "5"})
    url = f"{MB_BASE}/recording/?{qs}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": MB_USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    recordings = data.get("recordings") or []
    if not recordings:
        return None
    top = recordings[0]
    score = int(top.get("score") or 0)
    if score < MIN_CONFIDENCE:
        return None
    canonical_title = (top.get("title") or "").strip()
    artist_credits = top.get("artist-credit") or []
    canonical_artist = ""
    for ac in artist_credits:
        name = (ac.get("name") if isinstance(ac, dict) else "") or ""
        joinphrase = (ac.get("joinphrase") if isinstance(ac, dict) else "") or ""
        canonical_artist += name + joinphrase
    canonical_artist = canonical_artist.strip()
    if not canonical_title or not canonical_artist:
        return None
    return EnrichedMeta(
        title=canonical_title,
        artist=canonical_artist,
        source="musicbrainz",
        confidence=score,
    )


def enrich_metadata(raw_title: str, raw_artist: str = "") -> EnrichedMeta:
    """Look up the song on MusicBrainz across multiple search-string variants.

    Tries up to ~5 different parsings of the messy raw inputs, returns the
    HIGHEST-confidence match. Big improvement for filenames like
    "Seven Nation Army (The White Stripes)" where the artist hides in parens.
    """
    if not _clean_for_search(raw_title):
        return EnrichedMeta(title=raw_title, artist=raw_artist, source="original", confidence=0)

    best: EnrichedMeta | None = None
    for query in _search_variants(raw_title, raw_artist):
        result = _query_musicbrainz(query)
        if result and (best is None or result["confidence"] > best["confidence"]):
            best = result
            # Score 100 = exact match; no point trying more variants
            if best["confidence"] >= 100:
                break

    if best:
        return best
    return EnrichedMeta(title=raw_title, artist=raw_artist, source="original", confidence=0)


def fetch_album_art_url(title: str, artist: str) -> str | None:
    """Find album art via iTunes Search API (free, no key, ~95% hit on popular music).

    Returns a 600x600 artwork URL or None. Callers should download + cache.
    """
    if not title or not artist:
        return None
    qs = urllib.parse.urlencode({
        "term": f"{artist} {title}",
        "entity": "song",
        "limit": "1",
    })
    url = f"https://itunes.apple.com/search?{qs}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": MB_USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    results = data.get("results") or []
    if not results:
        return None
    art_100 = results[0].get("artworkUrl100") or ""
    if not art_100:
        return None
    # iTunes serves 100x100 by default; swap path segment for higher res.
    return art_100.replace("100x100bb", "600x600bb")
