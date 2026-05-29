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

    # --- Key detection (Krumhansl-Schmuckler on chroma) ---
    detected_key = _detect_key_via_librosa(in_path)

    # --- Chord detection (librosa-based, best-effort) ---
    # Returns a list of {time: float seconds, chord: str like 'C', 'Am'}.
    # We sidestep autochord/madmom/vamp dependency hell by doing template
    # matching against librosa's chroma features directly. Less accurate
    # than autochord on jazz/dense mixes, but solid for pop/rock.
    chord_events: list = _detect_chords_via_librosa(in_path)

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
            "key": detected_key,
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
        "key": detected_key,
        "model": model,
        "format": audio_format,
        "song_id": song_id,
    }


def _detect_key_via_librosa(audio_path) -> str:
    """Estimate musical key via Krumhansl-Schmuckler template matching on the
    summed chroma profile of the whole song.

    Returns strings like "C major", "A minor", or "Unknown" on failure.
    """
    try:
        import librosa
        import numpy as np
    except Exception:
        return "Unknown"

    try:
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        # Sum across time to get a single 12-bin profile of overall tonality.
        prof = chroma.sum(axis=1)
        norm = np.linalg.norm(prof)
        if norm < 1e-6:
            return "Unknown"
        prof = prof / norm
    except Exception as e:
        print(f"[key-detection] chroma failed: {e}")
        return "Unknown"

    # Krumhansl-Kessler key profiles (1990) — major/minor weights for C/c.
    # We rotate these 12 ways and pick the highest-correlation template.
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    best_score = -float('inf')
    best_key = "Unknown"
    for r in range(12):
        for tmpl, kind in ((major, "major"), (minor, "minor")):
            rotated = np.roll(tmpl, r)
            rotated = rotated / np.linalg.norm(rotated)
            score = float(np.dot(prof, rotated))
            if score > best_score:
                best_score = score
                best_key = f"{notes[r]} {kind}"
    return best_key


# ---------------------------------------------------------------------------
# Chord detection (librosa-only, dependency-free)
# ---------------------------------------------------------------------------

def _detect_chords_via_librosa(audio_path) -> list:
    """Template-match 24 major/minor chords against the song's chroma profile.

    Algorithm:
      1. Compute chroma_cqt (12-bin pitch-class energy over time)
      2. For each frame, find the major-or-minor chord template with the
         highest dot product after normalization
      3. Emit a {time, chord} event whenever the recognized chord changes
         (with hysteresis so we don't emit dozens of micro-changes per second)

    Limitations: only major + minor triads. Doesn't recognize 7ths, sus,
    diminished. Good enough for chord-strip practice display on pop/rock.
    """
    try:
        import librosa
        import numpy as np
    except Exception as e:
        print(f"[chord-detection] librosa/numpy import failed: {e}")
        return []

    try:
        # Stereo → mono, sample rate fixed for consistent chroma resolution.
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        # ~512 hop @ 22050 = ~23 ms per frame; smooth over a few frames for stability.
        hop = 512
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        # Median-filter the chroma over ~1.5 sec to suppress transients.
        from scipy.ndimage import median_filter
        chroma = median_filter(chroma, size=(1, 64))
        times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop)
    except Exception as e:
        print(f"[chord-detection] chroma extraction failed: {e}")
        return []

    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    # Triad templates — root, third, fifth — with the third differing maj vs min.
    major_template = np.array([1.0, 0, 0, 0, 1.0, 0, 0, 1.0, 0, 0, 0, 0])
    minor_template = np.array([1.0, 0, 0, 1.0, 0, 0, 0, 1.0, 0, 0, 0, 0])
    # Pre-rotate the 24 templates for fast matrix multiply.
    templates = np.stack(
        [np.roll(major_template, r) for r in range(12)]
        + [np.roll(minor_template, r) for r in range(12)],
        axis=0,
    )  # shape (24, 12)
    template_labels = (
        [note_names[r] for r in range(12)]
        + [f"{note_names[r]}m" for r in range(12)]
    )

    # Normalize each chroma column to unit length, then dot with templates.
    norms = np.linalg.norm(chroma, axis=0) + 1e-6
    chroma_norm = chroma / norms
    scores = templates @ chroma_norm  # (24, frames)
    winners = np.argmax(scores, axis=0)
    confidences = scores[winners, np.arange(scores.shape[1])]

    events: list = []
    last_chord = None
    last_time = -10.0
    MIN_GAP = 0.25  # don't emit chord changes faster than ~4 per second
    MIN_CONF = 0.55  # ignore "noisy" frames
    for i, w in enumerate(winners):
        if confidences[i] < MIN_CONF:
            continue
        label = template_labels[int(w)]
        t = float(times[i])
        if label != last_chord and (t - last_time) >= MIN_GAP:
            events.append({"time": round(t, 3), "chord": label})
            last_chord = label
            last_time = t
    return events
