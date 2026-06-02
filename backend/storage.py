"""R2 (or any S3-compatible) helpers for persisting song metadata.

Stems are uploaded to R2 by the Modal function directly (no local copy on
Render). Metadata (song_meta.json, lyrics.json, ...) is generated on the
Render side and needs its own persistence path — that's what this module
handles.

If R2 isn't configured (missing env vars), every function here becomes a
no-op so the rest of the app still works locally / on ephemeral disk.
"""
import json
import os
from pathlib import Path
from typing import Optional


def r2_status() -> dict:
    """Inspect which R2 env vars are set — used by /api/v1/_diag for debugging."""
    return {
        "bucket": bool(os.environ.get("R2_BUCKET", "").strip()),
        "account_id": bool(os.environ.get("R2_ACCOUNT_ID", "").strip()),
        "access_key_id": bool(os.environ.get("R2_ACCESS_KEY_ID", "").strip()),
        "secret_access_key": bool(os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()),
        "public_url_base": (os.environ.get("R2_PUBLIC_URL_BASE", "").strip()
                            or "(missing)"),
    }


def _r2_config() -> Optional[tuple]:
    """Return (client, bucket) if R2 is wired up, else None."""
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if not (bucket and account_id and access_key and secret_key):
        missing = [k for k, v in {
            "R2_BUCKET": bucket, "R2_ACCOUNT_ID": account_id,
            "R2_ACCESS_KEY_ID": access_key, "R2_SECRET_ACCESS_KEY": secret_key,
        }.items() if not v]
        print(f"[storage] R2 NOT configured (missing env vars: {missing})")
        return None
    try:
        import boto3
        from botocore.client import Config
        client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        return client, bucket
    except Exception as e:
        print(f"[storage] R2 client init failed: {e}")
        return None


def save_song_meta(song_id: str, meta: dict, local_path: Path) -> None:
    """Write song_meta.json both locally AND to R2 (best-effort)."""
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "w") as f:
        json.dump(meta, f, indent=2)

    cfg = _r2_config()
    if not cfg:
        print(f"[storage] LOCAL-ONLY save_song_meta({song_id}) — not on R2 (no config)")
        return
    client, bucket = cfg
    try:
        client.put_object(
            Bucket=bucket,
            Key=f"songs/{song_id}/song_meta.json",
            Body=json.dumps(meta, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
        print(f"[storage] R2 saved song_meta.json for {song_id}")
    except Exception as e:
        # Don't fail the import just because R2 is unreachable.
        print(f"[storage] R2 save_song_meta({song_id}) failed: {e}")


def save_song_cover_art(song_id: str, source_url: str, local_path: Path) -> str | None:
    """Download album art from a URL, save locally + R2, return the public R2 URL."""
    import urllib.request
    local_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(source_url, local_path)
    except Exception as e:
        print(f"[storage] cover download from {source_url[:80]} failed: {e}")
        return None

    cfg = _r2_config()
    if not cfg:
        return None
    client, bucket = cfg
    public_base = os.environ.get("R2_PUBLIC_URL_BASE", "").strip().rstrip("/")
    if not public_base:
        return None
    try:
        client.upload_file(
            Filename=str(local_path),
            Bucket=bucket,
            Key=f"songs/{song_id}/cover.jpg",
            ExtraArgs={"ContentType": "image/jpeg"},
        )
        print(f"[storage] R2 saved cover.jpg for {song_id}")
        return f"{public_base}/songs/{song_id}/cover.jpg"
    except Exception as e:
        print(f"[storage] R2 cover upload({song_id}) failed: {e}")
        return None


def save_data_blob_to_r2(name: str, data) -> None:
    """Push one of our small JSON state files (setlists, mix_snapshots,
    song_notes) up to R2 at data/<name>. Best-effort: never raises."""
    cfg = _r2_config()
    if not cfg:
        return
    client, bucket = cfg
    try:
        client.put_object(
            Bucket=bucket,
            Key=f"data/{name}",
            Body=json.dumps(data, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:
        print(f"[storage] R2 save_data_blob({name}) failed: {e}")


def load_data_blob_from_r2(name: str):
    """Try to fetch one of our small JSON state files from R2. Returns
    parsed JSON on success, None on any failure (no R2, key missing,
    parse error). Caller falls back to local disk."""
    cfg = _r2_config()
    if not cfg:
        return None
    client, bucket = cfg
    try:
        resp = client.get_object(Bucket=bucket, Key=f"data/{name}")
        return json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:
        # NoSuchKey is the common case on a fresh bucket — silent return.
        return None


def hydrate_data_blobs(local_data_dir: Path) -> int:
    """Pull setlists.json / mix_snapshots.json / song_notes.json down from
    R2 into the local cache so they survive container restarts on Render's
    ephemeral disk. Returns the count of blobs hydrated."""
    local_data_dir.mkdir(parents=True, exist_ok=True)
    hydrated = 0
    for name in ("setlists.json", "mix_snapshots.json", "song_notes.json"):
        blob = load_data_blob_from_r2(name)
        if blob is None:
            continue
        with open(local_data_dir / name, "w") as f:
            json.dump(blob, f, indent=2)
        hydrated += 1
    return hydrated


def save_song_lyrics(song_id: str, lyrics: dict, local_path: Path) -> None:
    """Persist a fetched lyrics blob both locally and to R2."""
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "w") as f:
        json.dump(lyrics, f, indent=2)
    cfg = _r2_config()
    if not cfg:
        return
    client, bucket = cfg
    try:
        client.put_object(
            Bucket=bucket,
            Key=f"songs/{song_id}/lyrics.json",
            Body=json.dumps(lyrics, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:
        print(f"[storage] R2 save_song_lyrics({song_id}) failed: {e}")


def sync_metas_from_r2(local_songs_root: Path) -> int:
    """Pull every song_meta.json + lyrics.json from R2 down to local disk.

    Called on backend startup (and optionally on demand). Returns the number
    of new files hydrated. No-op when R2 isn't configured.
    """
    cfg = _r2_config()
    if not cfg:
        print("[storage] sync_metas_from_r2: skipped (R2 not configured)")
        return 0
    client, bucket = cfg
    local_songs_root.mkdir(parents=True, exist_ok=True)
    hydrated = 0
    seen_objects = 0
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix="songs/"):
            for obj in page.get("Contents", []):
                seen_objects += 1
                key = obj["Key"]
                # We hydrate song_meta.json, lyrics.json, and cover.jpg —
                # stems don't need a local copy (served from R2 via 302).
                if not any(key.endswith(s) for s in (
                    "/song_meta.json", "/lyrics.json", "/cover.jpg"
                )):
                    continue
                # key shape: songs/<song_id>/<filename>
                parts = key.split("/")
                if len(parts) != 3:
                    continue
                song_id, filename = parts[1], parts[2]
                local_dir = local_songs_root / song_id
                local_dir.mkdir(parents=True, exist_ok=True)
                local_file = local_dir / filename
                if local_file.exists():
                    continue
                try:
                    body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
                    local_file.write_bytes(body)
                    hydrated += 1
                except Exception as e:
                    print(f"[storage] failed to hydrate {key}: {e}")
        print(f"[storage] sync_metas_from_r2: scanned {seen_objects} R2 objects, hydrated {hydrated}")
    except Exception as e:
        print(f"[storage] sync_metas_from_r2 failed: {e}")
    return hydrated


def delete_song_from_r2(song_id: str) -> None:
    """Delete every object under songs/{song_id}/ in R2 (best-effort)."""
    cfg = _r2_config()
    if not cfg:
        return
    client, bucket = cfg
    try:
        # List + delete in batches of 1000 (S3 batch-delete cap).
        paginator = client.get_paginator("list_objects_v2")
        to_delete: list[dict] = []
        for page in paginator.paginate(Bucket=bucket, Prefix=f"songs/{song_id}/"):
            for obj in page.get("Contents", []):
                to_delete.append({"Key": obj["Key"]})
                if len(to_delete) >= 1000:
                    client.delete_objects(Bucket=bucket, Delete={"Objects": to_delete})
                    to_delete = []
        if to_delete:
            client.delete_objects(Bucket=bucket, Delete={"Objects": to_delete})
    except Exception as e:
        print(f"[storage] delete_song_from_r2({song_id}) failed: {e}")
