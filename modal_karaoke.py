"""Modal function for on-demand stem refinement:
   - vocals -> (lead, backing) via UVR-MDX-NET Karaoke 2 (ML)
   - stereo stem -> (left, right) via ffmpeg channel split (cheap, no model)

Separate Modal app from `modal_demucs.py` because (a) different image deps
(audio-separator + onnxruntime-gpu) and (b) this is per-song on-demand, not
part of the initial slicing pipeline, so it has its own lifecycle.

----- DEPLOY -----

    pip install modal                          # if you haven't already
    modal token new                            # one-time auth
    modal deploy modal_karaoke.py

Modal prints a URL like:
    https://<your-username>--slicersmthng-karaoke-split-vocals.modal.run

Add it to Render as MODAL_KARAOKE_URL.
"""
import modal

app = modal.App("slicersmthng-karaoke")

# audio-separator wraps UVR's ONNX models. [gpu] extra pulls in
# onnxruntime-gpu; on a T4 the karaoke pass is ~10-30s for a 4-min vocals
# stem (vs minutes on CPU).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "audio-separator[gpu]>=0.28.0",
        "fastapi[standard]",
        "boto3>=1.34",
        "requests>=2.31",
    )
)


@app.function(
    image=image,
    gpu="T4",
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials", required_keys=[])],
)
@modal.fastapi_endpoint(method="POST")
def split_vocals(req: dict) -> dict:
    """Run UVR-MDX-NET Karaoke 2 on a vocals stem.

    Request:
        { "vocals_url": "https://r2-pub/.../vocals.mp3",
          "song_id":    "abc_12345678",
          "source_stem": "vocals" }       # base name for outputs

    Response (R2 configured):
        { "lead_url": "...", "backing_url": "...",
          "lead_key": "vocals_lead", "backing_key": "vocals_backing" }

    Response (no R2):
        { "lead_b64": "...", "backing_b64": "...",
          "lead_key": "vocals_lead", "backing_key": "vocals_backing" }
    """
    import base64
    import os
    import tempfile
    from pathlib import Path

    import requests

    vocals_url = req.get("vocals_url") or ""
    song_id = (req.get("song_id") or "").replace("/", "_")
    source_stem = (req.get("source_stem") or "vocals").replace("/", "_")

    if not vocals_url:
        return {"error": "vocals_url is required"}
    if not song_id:
        return {"error": "song_id is required"}

    work = Path(tempfile.mkdtemp(prefix="karaoke_"))
    in_path = work / f"{source_stem}.mp3"
    out_dir = work / "out"
    out_dir.mkdir()

    # Download the source vocals stem from R2 (or wherever).
    try:
        r = requests.get(vocals_url, timeout=120)
        r.raise_for_status()
        in_path.write_bytes(r.content)
    except Exception as e:
        return {"error": f"download failed: {e}"}

    # Run separator. UVR-MDX-NET-Karaoke-2 is the community standard for
    # main-vocal vs backing-vocal separation when applied to a vocals stem.
    try:
        from audio_separator.separator import Separator

        sep = Separator(
            output_dir=str(out_dir),
            output_format="MP3",
            mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.25, "batch_size": 1},
        )
        sep.load_model(model_filename="UVR-MDX-NET-Karaoke-2.onnx")
        output_files = sep.separate(str(in_path))
    except Exception as e:
        return {"error": f"separation failed: {e}"}

    if len(output_files) < 2:
        return {"error": f"expected 2 output files, got {len(output_files)}: {output_files}"}

    # Map outputs to lead vs backing. UVR-MDX-NET-Karaoke-2 produces filenames
    # like `<basename>_(Vocals)_<model>.mp3` (lead) and
    # `<basename>_(Instrumental)_<model>.mp3` (backing). Naming has shifted
    # across audio-separator versions, so we use multiple heuristics.
    def resolve(p: str) -> Path:
        path = Path(p)
        if not path.is_absolute():
            path = out_dir / path
        return path

    lead_path = None
    backing_path = None
    for f in output_files:
        path = resolve(f)
        name = path.name.lower()
        if any(k in name for k in ("vocals", "main", "lead")):
            lead_path = path
        elif any(k in name for k in ("instrumental", "karaoke", "back")):
            backing_path = path

    # Fallback: trust the order audio-separator returned them in.
    if not (lead_path and backing_path):
        lead_path = resolve(output_files[0])
        backing_path = resolve(output_files[1])

    if not (lead_path.exists() and backing_path.exists()):
        return {"error": f"output files missing on disk: lead={lead_path}, backing={backing_path}"}

    # --- Upload to R2 if configured ---
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    public_base = os.environ.get("R2_PUBLIC_URL_BASE", "").strip().rstrip("/")

    lead_key = f"{source_stem}_lead"
    backing_key = f"{source_stem}_backing"

    if bucket and account_id and access_key and secret_key and public_base:
        import boto3
        from botocore.client import Config
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        try:
            r2.upload_file(str(lead_path), bucket,
                           f"songs/{song_id}/stems/{lead_key}.mp3",
                           ExtraArgs={"ContentType": "audio/mpeg"})
            r2.upload_file(str(backing_path), bucket,
                           f"songs/{song_id}/stems/{backing_key}.mp3",
                           ExtraArgs={"ContentType": "audio/mpeg"})
        except Exception as e:
            return {"error": f"R2 upload failed: {e}"}

        return {
            "lead_url": f"{public_base}/songs/{song_id}/stems/{lead_key}.mp3",
            "backing_url": f"{public_base}/songs/{song_id}/stems/{backing_key}.mp3",
            "lead_key": lead_key,
            "backing_key": backing_key,
        }

    # --- Fallback: base64 in JSON (no R2 configured) ---
    return {
        "lead_b64": base64.b64encode(lead_path.read_bytes()).decode("ascii"),
        "backing_b64": base64.b64encode(backing_path.read_bytes()).decode("ascii"),
        "lead_key": lead_key,
        "backing_key": backing_key,
    }
