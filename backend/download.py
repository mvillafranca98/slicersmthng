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
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def _download_to(url: str, dest: Path) -> None:
    """Materialize a remote stem to disk so ffmpeg/zip can read it."""
    with urllib.request.urlopen(url, timeout=120) as resp:
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
