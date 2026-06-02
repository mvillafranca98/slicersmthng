"""Per-song on-demand stem splitting.

Two split methods, chosen by the frontend:

  'lr'        Split a stereo stem into separate left + right channels.
              Runs locally on Render via ffmpeg — fast, no GPU, no Modal hop.
              Useful when two guitars are panned L/R in the original mix.

  'karaoke'   Run UVR-MDX-NET-Karaoke-2 on a vocals stem to separate lead
              vs backing vocals. Calls modal_karaoke.split_vocals; requires
              MODAL_KARAOKE_URL env var to be set.

Both modes ADD new stems to the song meta without removing the original,
so the user can A/B between the merged and split versions.
"""
import base64
import json
import os
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

import boto3
from botocore.client import Config

from backend.storage import save_song_meta


ProgressCb = Callable[[str, int, str], None]


def _r2_client_or_none():
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    public_base = os.environ.get("R2_PUBLIC_URL_BASE", "").strip().rstrip("/")
    if not (bucket and account_id and access_key and secret_key and public_base):
        return None
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    return client, bucket, public_base


def _download_to_tmp(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=120) as resp:
        dest.write_bytes(resp.read())


def _ffmpeg_extract_channel(src: Path, dst: Path, channel: str) -> None:
    """Extract a single channel ('FL' or 'FR') from a stereo file to mono."""
    # `pan` filter: 'mono|c0=FL' picks left, 'mono|c0=FR' picks right.
    pan = f"mono|c0={channel}"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src),
         "-af", f"pan={pan}",
         "-codec:a", "libmp3lame", "-b:a", "320k",
         str(dst)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg channel-extract failed: {proc.stderr[-500:]}")


def _resolve_source_stem(meta: dict, source_stem: str) -> tuple[str, Optional[Path]]:
    """Return (url_or_empty, local_path_or_none) for the requested stem.

    Prefers the R2 URL (if the meta has stem_urls), falls back to the local
    file on Render's disk. Either is usable as input.
    """
    stem_urls = meta.get("stem_urls") or {}
    if source_stem in stem_urls and stem_urls[source_stem]:
        return stem_urls[source_stem], None
    # Local fallback — older slices may not have R2 URLs.
    from backend.config import get_storage
    from backend.utils import get_song_dir
    song_dir = get_song_dir(get_storage(), meta["id"])
    for ext in ("mp3", "wav", "flac"):
        p = song_dir / "stems" / f"{source_stem}.{ext}"
        if p.exists():
            return "", p
    return "", None


def _update_meta_with_new_stems(meta: dict, meta_path: Path, new_stems: dict[str, str]) -> dict:
    """Add new stems + URLs into the song meta and persist.

    new_stems: { stem_name: public_url }
    Idempotent: re-running the same split overwrites the URL but doesn't
    duplicate the stem name in the list.
    """
    stems_list = list(meta.get("stems") or [])
    stem_urls = dict(meta.get("stem_urls") or {})
    for name, url in new_stems.items():
        if name not in stems_list:
            stems_list.append(name)
        stem_urls[name] = url
    meta["stems"] = stems_list
    meta["stem_urls"] = stem_urls
    save_song_meta(meta["id"], meta, meta_path)
    return meta


# ---------------------------------------------------------------------------
# Method: 'lr' — ffmpeg local
# ---------------------------------------------------------------------------

def split_lr(meta: dict, meta_path: Path, source_stem: str, progress: ProgressCb) -> dict:
    progress("preparing", 10, f"Preparing {source_stem} for L/R split...")
    url, local = _resolve_source_stem(meta, source_stem)
    if not (url or local):
        raise RuntimeError(f"Source stem '{source_stem}' not found for this song.")

    work = Path(tempfile.mkdtemp(prefix="lrsplit_"))
    src_path = work / f"{source_stem}.mp3"
    if local:
        src_path.write_bytes(local.read_bytes())
    else:
        progress("downloading", 25, "Downloading source stem...")
        _download_to_tmp(url, src_path)

    left_key = f"{source_stem}_left"
    right_key = f"{source_stem}_right"
    left_path = work / f"{left_key}.mp3"
    right_path = work / f"{right_key}.mp3"

    progress("splitting", 50, "Extracting L + R channels with ffmpeg...")
    _ffmpeg_extract_channel(src_path, left_path, "FL")
    _ffmpeg_extract_channel(src_path, right_path, "FR")

    # Upload to R2 if available, else stash locally and serve via legacy path.
    r2 = _r2_client_or_none()
    new_stems: dict[str, str] = {}
    if r2:
        progress("uploading", 80, "Uploading split stems to R2...")
        client, bucket, public_base = r2
        for key, path in ((left_key, left_path), (right_key, right_path)):
            r2_key = f"songs/{meta['id']}/stems/{key}.mp3"
            client.upload_file(
                Filename=str(path), Bucket=bucket, Key=r2_key,
                ExtraArgs={"ContentType": "audio/mpeg"},
            )
            new_stems[key] = f"{public_base}/{r2_key}"
    else:
        # No R2 -> write next to the existing local stems so /stems/<name>
        # picks them up via the legacy file-serving fallback.
        from backend.config import get_storage
        from backend.utils import get_song_dir
        stems_dir = get_song_dir(get_storage(), meta["id"]) / "stems"
        stems_dir.mkdir(parents=True, exist_ok=True)
        for key, path in ((left_key, left_path), (right_key, right_path)):
            dest = stems_dir / f"{key}.mp3"
            dest.write_bytes(path.read_bytes())
            new_stems[key] = ""  # empty URL = backend falls back to local file
        # When stem_urls value is "" the stream endpoint must NOT redirect;
        # easier to just omit from stem_urls.
        new_stems = {k: v for k, v in new_stems.items() if v}

    progress("finalizing", 95, "Updating song metadata...")
    return _update_meta_with_new_stems(meta, meta_path, new_stems)


# ---------------------------------------------------------------------------
# Method: 'karaoke' — Modal UVR
# ---------------------------------------------------------------------------

def split_karaoke(meta: dict, meta_path: Path, source_stem: str, progress: ProgressCb) -> dict:
    modal_url = os.environ.get("MODAL_KARAOKE_URL", "").strip()
    if not modal_url:
        raise RuntimeError(
            "MODAL_KARAOKE_URL is not set. Deploy modal_karaoke.py "
            "and add the printed URL as MODAL_KARAOKE_URL on Render."
        )

    progress("preparing", 10, f"Preparing {source_stem} for karaoke split...")
    url, local = _resolve_source_stem(meta, source_stem)
    if not url:
        # We need a publicly-fetchable URL so Modal can pull the audio.
        # If only local exists, we'd have to base64-upload — skip for now.
        if local:
            raise RuntimeError(
                "Karaoke split requires the source stem to be on R2; "
                "this song was sliced before R2 was wired up. Re-slice the "
                "song or use the L/R split instead."
            )
        raise RuntimeError(f"Source stem '{source_stem}' not found for this song.")

    progress("separating", 40, "Running UVR-MDX-NET Karaoke on Modal GPU...")
    payload = json.dumps({
        "vocals_url": url,
        "song_id": meta["id"],
        "source_stem": source_stem,
    }).encode("utf-8")
    req = urllib.request.Request(
        modal_url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"Modal karaoke HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Modal karaoke unreachable: {e}") from e

    if not isinstance(body, dict) or body.get("error"):
        raise RuntimeError(f"Modal karaoke error: {body.get('error') if isinstance(body, dict) else body}")

    progress("finalizing", 90, "Updating song metadata...")
    lead_key = body.get("lead_key") or f"{source_stem}_lead"
    backing_key = body.get("backing_key") or f"{source_stem}_backing"

    new_stems: dict[str, str] = {}
    if body.get("lead_url"):
        new_stems[lead_key] = body["lead_url"]
    if body.get("backing_url"):
        new_stems[backing_key] = body["backing_url"]

    if not new_stems and (body.get("lead_b64") or body.get("backing_b64")):
        # No R2 on Modal — write the bytes locally and serve via legacy path.
        from backend.config import get_storage
        from backend.utils import get_song_dir
        stems_dir = get_song_dir(get_storage(), meta["id"]) / "stems"
        stems_dir.mkdir(parents=True, exist_ok=True)
        if body.get("lead_b64"):
            (stems_dir / f"{lead_key}.mp3").write_bytes(base64.b64decode(body["lead_b64"]))
        if body.get("backing_b64"):
            (stems_dir / f"{backing_key}.mp3").write_bytes(base64.b64decode(body["backing_b64"]))

    if not new_stems:
        # We still got files locally but no public URLs.
        # Adding the stem names to the meta is enough; the stream endpoint
        # serves from local disk when there's no entry in stem_urls.
        stems_list = list(meta.get("stems") or [])
        for k in (lead_key, backing_key):
            if k not in stems_list:
                stems_list.append(k)
        meta["stems"] = stems_list
        save_song_meta(meta["id"], meta, meta_path)
        return meta

    return _update_meta_with_new_stems(meta, meta_path, new_stems)


# ---------------------------------------------------------------------------
# Public entry point used by routes.py
# ---------------------------------------------------------------------------

def run_split(meta: dict, meta_path: Path, source_stem: str, method: str, progress: ProgressCb) -> dict:
    if method == "lr":
        return split_lr(meta, meta_path, source_stem, progress)
    if method == "karaoke":
        return split_karaoke(meta, meta_path, source_stem, progress)
    raise RuntimeError(f"unknown split method: {method!r}")
