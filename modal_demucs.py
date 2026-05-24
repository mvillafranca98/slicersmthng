"""Modal function for Demucs stem separation.

This is the FREE alternative to Replicate. Modal gives $30/mo of compute
credit (no card required for sign-up), which translates to roughly 1,500
free song separations per month at T4-GPU pricing.

----- DEPLOY (one-time on your laptop, not on Render) -----

    pip install modal
    modal token new                # opens browser to authenticate
    modal deploy modal_demucs.py   # uploads + builds the image, returns a URL

Modal prints a URL like:
    https://<your-username>--slicersmthng-demucs-separate.modal.run

Copy that URL.

----- WIRE IT INTO THE RENDER SERVICE -----

In the Render dashboard, on your slicersmthng service → Environment, set:
    STEM_SEPARATOR     = modal
    MODAL_DEMUCS_URL   = https://<your-username>--slicersmthng-demucs-separate.modal.run

Save → Render redeploys → "Slice It" now routes to Modal instead of Replicate.

----- HOW IT WORKS -----

The Render backend POSTs the audio file (base64-encoded in JSON for
simplicity) to the Modal URL. Modal cold-starts a T4 GPU, runs Demucs,
returns the stems (also base64) in the JSON response. Cold start adds
~30 sec on the first call after idle; subsequent calls are instant.

----- COST -----

T4 GPU on Modal is ~$0.000596/sec. A 3-min song separates in ~30 sec of
GPU time = ~$0.018/song. $30 free credit = ~1,600 free songs/month.
"""
import modal

app = modal.App("slicersmthng-demucs")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "demucs>=4.0.1",
        "torch>=2.0.0",
        "torchaudio>=2.0.0",
        "soundfile>=0.12.0",
        "fastapi[standard]",
    )
)


@app.function(
    image=image,
    gpu="T4",
    timeout=600,  # 10 min hard cap; a 5-min song usually finishes in <60 sec
)
@modal.fastapi_endpoint(method="POST")
def separate(req: dict) -> dict:
    """Stem-separate audio. Request: {audio_b64, model, format}. Returns {stems: {name: b64}}.

    audio_b64  — base64 of the input audio file (MP3/WAV/FLAC/M4A/...)
    model      — htdemucs (default), htdemucs_ft, or htdemucs_6s
    format     — mp3 (default) or flac
    """
    import base64
    import subprocess
    import tempfile
    from pathlib import Path

    audio_b64 = req.get("audio_b64") or ""
    model = req.get("model") or "htdemucs"
    audio_format = req.get("format") or "mp3"

    if model not in ("htdemucs", "htdemucs_ft", "htdemucs_6s"):
        model = "htdemucs"
    fmt_flag = "--mp3" if audio_format == "mp3" else "--flac"

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception as e:
        return {"error": f"audio_b64 decode failed: {e}"}
    if not audio_bytes:
        return {"error": "audio_b64 was empty"}

    work = Path(tempfile.mkdtemp(prefix="demucs_"))
    in_path = work / "input.mp3"
    in_path.write_bytes(audio_bytes)
    out_dir = work / "out"
    out_dir.mkdir()

    cmd = [
        "demucs",
        "-n", model,
        fmt_flag,
        "--mp3-bitrate", "320",
        "-o", str(out_dir),
        str(in_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return {"error": f"demucs failed: {proc.stderr[-500:] or proc.stdout[-500:]}"}

    separated = out_dir / model / "input"
    ext = "mp3" if audio_format == "mp3" else "flac"

    stems: dict[str, str] = {}
    for stem_file in sorted(separated.glob(f"*.{ext}")):
        stems[stem_file.stem] = base64.b64encode(stem_file.read_bytes()).decode("ascii")

    if not stems:
        return {"error": f"No stems written. Files: {[p.name for p in separated.iterdir()]}"}

    return {"stems": stems, "model": model, "format": audio_format}
