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


def _r2_config() -> Optional[tuple]:
    """Return (client, bucket) if R2 is wired up, else None."""
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if not (bucket and account_id and access_key and secret_key):
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
        return
    client, bucket = cfg
    try:
        client.put_object(
            Bucket=bucket,
            Key=f"songs/{song_id}/song_meta.json",
            Body=json.dumps(meta, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:
        # Don't fail the import just because R2 is unreachable.
        print(f"[storage] R2 save_song_meta({song_id}) failed: {e}")


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
        return 0
    client, bucket = cfg
    local_songs_root.mkdir(parents=True, exist_ok=True)
    hydrated = 0
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix="songs/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                # We only care about song_meta.json and lyrics.json — stems
                # don't need to be on Render's disk (served from R2 via 302).
                if not (key.endswith("/song_meta.json") or key.endswith("/lyrics.json")):
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
