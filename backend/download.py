"""On-demand stem-export helpers.

Two output modes are exposed to the frontend:

  merge_stems_to_mp3   ffmpeg `amix` of N stems → one mp3 file.
                       Use for "drum-and-bass backing track for guitarist
                       to practice over" style downloads.

  zip_stems            zip of each selected stem as its own mp3.
                       Use when the user wants to pull the parts into
                       their own DAW.

Both pull from R2 (when stem_urls are set on the song meta) or from
Render's local disk (legacy path), whichever resolves first.
"""
import io
import os
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path


# Cloudflare's CDN frequently 403s the default `Python-urllib/3.x` UA as
# scraper-looking. A real browser UA gets through for any public URL.
_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Safari/605.1.15"
)


def _download_to(url: str, dest: Path) -> None:
    """Materialize a remote stem to disk so ffmpeg/zip can read it.

    Two paths, in order of preference:

      1. If the URL is one of OUR R2 public objects AND R2 credentials are
         on this process, fetch directly via boto3.get_object. This bypasses
         Cloudflare's CDN entirely — no UA filtering, no rate limit, works
         even if the r2.dev base is set to private. This is the normal
         path for stems we sliced ourselves.

      2. Otherwise, fall back to urllib with a browser User-Agent header.
         Covers third-party URLs and the edge case where R2 env vars aren't
         set on this process (local dev).
    """
    public_base = os.environ.get("R2_PUBLIC_URL_BASE", "").strip().rstrip("/")
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if (public_base and url.startswith(public_base + "/") and
            bucket and account_id and access_key and secret_key):
        key = url[len(public_base) + 1:]
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
        resp = client.get_object(Bucket=bucket, Key=key)
        dest.write_bytes(resp["Body"].read())
        return

    req = urllib.request.Request(url, headers={"User-Agent": _BROWSER_UA})
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())


def _gather_inputs(sources: list[tuple[str, Path | None]], work: Path) -> list[Path]:
    """sources: list of (url, local_path_or_None). Returns list of local Paths
    in the same order, downloading from URL into `work/` if no local path."""
    out: list[Path] = []
    for i, (url, local) in enumerate(sources):
        if local and local.exists():
            out.append(local)
            continue
        if not url:
            raise RuntimeError(f"stem #{i} has neither URL nor local path")
        dest = work / f"in_{i}.mp3"
        _download_to(url, dest)
        out.append(dest)
    return out


def merge_stems_to_mp3(sources: list[tuple[str, Path | None]], output_path: Path) -> None:
    """Sum N stems into a single mp3 via ffmpeg's amix filter.

    `normalize=0` keeps the original per-stem levels (Demucs stems were
    designed to sum back to the original mix — summing a subset gives a
    correctly-leveled partial mix). With normalize=1 ffmpeg would divide
    each input by N, making the result much quieter than the source.

    320 kbps libmp3lame mirrors the original demucs output bitrate.
    """
    work = Path(tempfile.mkdtemp(prefix="merge_"))
    inputs = _gather_inputs(sources, work)
    if not inputs:
        raise RuntimeError("no stems to merge")

    cmd: list[str] = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd += ["-i", str(inp)]
    cmd += [
        "-filter_complex",
        f"amix=inputs={len(inputs)}:duration=longest:normalize=0",
        "-codec:a", "libmp3lame",
        "-b:a", "320k",
        str(output_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg merge failed: {proc.stderr[-500:] or proc.stdout[-500:]}")


def zip_stems(sources: list[tuple[str, Path | None]], names: list[str]) -> bytes:
    """Bundle each source mp3 as `<song>_<stem>.mp3` inside a zip blob.

    Returns the zip bytes (small enough to hold in memory — stem files are
    a few MB each, six of them ~25 MB total).
    """
    work = Path(tempfile.mkdtemp(prefix="zip_"))
    inputs = _gather_inputs(sources, work)
    if len(inputs) != len(names):
        raise RuntimeError(f"name/input mismatch: {len(names)} names vs {len(inputs)} inputs")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, path in zip(names, inputs):
            z.write(path, arcname=name)
    return buf.getvalue()
