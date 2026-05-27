"""Modal function for Demucs stem separation, with optional Cloudflare R2 upload.

If R2 credentials are set on this Modal function via a Modal Secret, separated
stems are uploaded directly to your R2 bucket and the function returns public
URLs. Otherwise it falls back to returning the stems as base64 in JSON (legacy
mode — works without R2, but is slow on bigger songs and stems vanish on
container restart).

The function also runs lightweight BPM detection while the audio file is in
hand — way faster on Modal's CPU than on Render's 0.5-CPU free tier.

----- DEPLOY (one-time on your laptop) -----

    pip install modal
    modal token new                # opens browser to authenticate (no card)

Then, if you want R2 storage (recommended), create the Modal Secret first:

    modal secret create r2-credentials \\
        R2_ACCOUNT_ID=<your account id> \\
        R2_ACCESS_KEY_ID=<your r2 access key> \\
        R2_SECRET_ACCESS_KEY=<your r2 secret> \\
        R2_BUCKET=<your bucket name> \\
        R2_PUBLIC_URL_BASE=https://pub-<id>.r2.dev   # NO trailing slash

Then deploy:

    modal deploy modal_demucs.py

Modal prints a URL like:
    https://<your-username>--slicersmthng-demucs-separate.modal.run

That's what you paste into MODAL_DEMUCS_URL on Render.

----- WIRE IT INTO THE RENDER SERVICE -----

In the Render dashboard, on your slicersmthng service → Environment, set:
    STEM_SEPARATOR    = modal
    MODAL_DEMUCS_URL  = https://<your-username>--slicersmthng-demucs-separate.modal.run

Plus the SAME R2 env vars so the backend's stem-redirect route can build URLs:
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET
    R2_PUBLIC_URL_BASE
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
        "librosa>=0.10.0",
        "autochord>=0.1.0",  # NEW: chord detection (uses madmom under the hood)
        "fastapi[standard]",
        "boto3>=1.34",
    )
)


@app.function(
    image=image,
    gpu="T4",
    timeout=600,
    # Inject R2 credentials if the Secret exists. If you didn't create
    # 'r2-credentials' on Modal, the function still runs in legacy
    # base64-return mode — you'll just see big slow JSON responses.
    secrets=[modal.Secret.from_name("r2-credentials", required_keys=[])],
)
@modal.fastapi_endpoint(method="POST")
def separate(req: dict) -> dict:
    """Stem-separate audio + optionally upload to R2.

    Request: {audio_b64, model, format, song_id?}
    Response when R2 configured: {stems_urls: {name: url}, bpm, duration, ...}
    Response when R2 absent:     {stems: {name: b64_data}, bpm, duration, ...}
    """
    import base64
    import os
    import subprocess
    import tempfile
    import uuid
    from pathlib import Path

    audio_b64 = req.get("audio_b64") or ""
    model = req.get("model") or "htdemucs"
    audio_format = req.get("format") or "mp3"
    song_id = (req.get("song_id") or uuid.uuid4().hex).replace("/", "_")

    if model not in ("htdemucs", "htdemucs_ft", "htdemucs_6s"):
        model = "htdemucs"
    fmt_flag = "--mp3" if audio_format == "mp3" else "--flac"
    ext = "mp3" if audio_format == "mp3" else "flac"

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

    # --- BPM + duration (lightweight; runs on this container's CPU) ---
    bpm = 120.0
    duration_sec = 0.0
    try:
        import librosa
        import soundfile as sf
        try:
            info = sf.info(str(in_path))
            duration_sec = float(info.duration)
        except Exception:
            duration_sec = 0.0
        # Bound librosa to first 60 sec for speed; that's plenty for BPM.
        y, sr = librosa.load(str(in_path), sr=22050, mono=True, duration=60)
        if not duration_sec:
            duration_sec = float(len(y)) / float(sr)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        try:
            bpm_raw = float(tempo)
        except (TypeError, ValueError):
            bpm_raw = float(tempo[0]) if hasattr(tempo, '__len__') and len(tempo) else 120.0
        if 30 <= bpm_raw <= 300:
            bpm = bpm_raw
    except Exception:
        pass  # analysis is best-effort; defaults are fine

    # --- Chord detection (autochord, best-effort) ---
    # Returns a list of {time: float seconds, chord: str like 'C', 'Am', 'F#m7'}.
    # Falls back to empty on any failure — chord strip just stays empty.
    chord_events: list = []
    try:
        import autochord
        # autochord.recognize returns list of (start_sec, end_sec, chord_label)
        raw = autochord.recognize(str(in_path))
        for entry in raw:
            try:
                start = float(entry[0])
                label = str(entry[2]).strip()
            except Exception:
                continue
            if not label or label.lower() in ("n", "no chord", "x"):
                # skip "no chord" placeholders
                continue
            chord_events.append({"time": start, "chord": label})
    except Exception as e:
        print(f"[chord-detection] failed: {e}")

    # --- Demucs separation ---
    proc = subprocess.run(
        ["demucs", "-n", model, fmt_flag, "--mp3-bitrate", "320",
         "-o", str(out_dir), str(in_path)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return {"error": f"demucs failed: {proc.stderr[-500:] or proc.stdout[-500:]}"}

    separated = out_dir / model / "input"
    stem_files = sorted(separated.glob(f"*.{ext}"))
    if not stem_files:
        return {"error": f"No stems written. Files: {[p.name for p in separated.iterdir()]}"}

    # --- Path A: upload to R2 if credentials present ---
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    public_base = os.environ.get("R2_PUBLIC_URL_BASE", "").strip().rstrip("/")

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
        stems_urls: dict[str, str] = {}
        for stem_file in stem_files:
            key = f"songs/{song_id}/stems/{stem_file.name}"
            try:
                r2.upload_file(
                    Filename=str(stem_file),
                    Bucket=bucket,
                    Key=key,
                    ExtraArgs={"ContentType": f"audio/{'mpeg' if ext == 'mp3' else ext}"},
                )
                stems_urls[stem_file.stem] = f"{public_base}/{key}"
            except Exception as e:
                return {"error": f"R2 upload of {stem_file.name} failed: {e}"}

        return {
            "stems_urls": stems_urls,
            "bpm": bpm,
            "duration": duration_sec,
            "chords": chord_events,
            "model": model,
            "format": audio_format,
            "song_id": song_id,
        }

    # --- Path B: legacy base64 (R2 not configured) ---
    stems_b64: dict[str, str] = {}
    for stem_file in stem_files:
        stems_b64[stem_file.stem] = base64.b64encode(stem_file.read_bytes()).decode("ascii")

    return {
        "stems": stems_b64,
        "bpm": bpm,
        "duration": duration_sec,
        "chords": chord_events,
        "model": model,
        "format": audio_format,
        "song_id": song_id,
    }
