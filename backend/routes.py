"""Flask API routes for SlicerSmthng (PRD §9.2)."""
import json
import threading
import uuid
from pathlib import Path
from flask import Blueprint, request, jsonify, send_file

from backend.config import get_storage
from backend.utils import get_song_dir, sanitize_filename
from backend.jobs import run_import, run_import_file
from backend.data import (
    load_setlists,
    save_setlists,
    load_snapshots,
    save_snapshots,
    get_snapshot,
    set_snapshot,
    load_notes,
    save_notes,
)

api = Blueprint("api", __name__, url_prefix="/api/v1")
storage = get_storage()
jobs = {}  # job_id -> { status, stage, percent, message, result, error }
jobs_lock = threading.Lock()
socketio = None

def set_socketio(sio):
    global socketio
    socketio = sio

def _emit_job_progress(job_id, stage, percent, message):
    if socketio:
        socketio.emit("job:progress", {"job_id": job_id, "stage": stage, "percent": percent, "message": message})

def _emit_job_complete(job_id, song):
    if socketio:
        socketio.emit("job:complete", {"job_id": job_id, "song": song})

def _emit_job_error(job_id, error):
    if socketio:
        socketio.emit("job:error", {"job_id": job_id, "error": error})

def _list_songs():
    songs_root = storage / "songs"
    out = []
    if not songs_root.exists():
        return out
    for song_dir in songs_root.iterdir():
        if not song_dir.is_dir():
            continue
        meta_path = song_dir / "song_meta.json"
        if not meta_path.exists():
            continue
        with open(meta_path) as f:
            meta = json.load(f)
        notes = load_notes().get(meta["id"], "")
        meta["notes"] = notes
        meta["thumbnail_url"] = f"/api/v1/songs/{meta['id']}/thumbnail"
        out.append(meta)
    return sorted(out, key=lambda s: s.get("added_at", ""), reverse=True)

# ----- Import & Jobs -----

@api.route("/import", methods=["POST"])
def import_url():
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    model = data.get("model", "htdemucs")
    quality = data.get("format", "mp3")
    if not url or "youtube" not in url and "youtu.be" not in url:
        return jsonify({"error": "Valid YouTube URL required"}), 400
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "pending", "stage": "", "percent": 0, "message": ""}

    def on_progress(jid, stage, percent, message):
        with jobs_lock:
            if jid in jobs:
                jobs[jid].update(status="running", stage=stage, percent=percent, message=message)
        _emit_job_progress(jid, stage, percent, message)

    def run():
        try:
            song = run_import(job_id, url, model, quality, storage, on_progress)
            with jobs_lock:
                jobs[job_id].update(status="done", result=song, percent=100)
            _emit_job_complete(job_id, song)
        except Exception as e:
            with jobs_lock:
                jobs[job_id].update(status="error", error=str(e))
            _emit_job_error(job_id, str(e))

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return jsonify({"job_id": job_id})

@api.route("/import-file", methods=["POST"])
def import_file():
    """Multipart upload fallback when YouTube blocks the server's IP."""
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"error": "No file uploaded (multipart field 'file')"}), 400

    allowed = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus"}
    suffix = Path(upload.filename).suffix.lower()
    if suffix not in allowed:
        return jsonify({"error": f"Unsupported audio type {suffix}. Try MP3/WAV/FLAC/M4A."}), 400

    model = request.form.get("model", "htdemucs")
    quality = request.form.get("format", "mp3")

    # Persist the upload to a temp path before handing off to the worker thread.
    import tempfile
    safe_name = sanitize_filename(upload.filename) or ("upload" + suffix)
    tmp_dir = Path(tempfile.mkdtemp(prefix="slcr_"))
    tmp_path = tmp_dir / safe_name
    upload.save(str(tmp_path))

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "pending", "stage": "", "percent": 0, "message": ""}

    def on_progress(jid, stage, percent, message):
        with jobs_lock:
            if jid in jobs:
                jobs[jid].update(status="running", stage=stage, percent=percent, message=message)
        _emit_job_progress(jid, stage, percent, message)

    def run():
        try:
            song = run_import_file(job_id, tmp_path, safe_name, model, quality, storage, on_progress)
            with jobs_lock:
                jobs[job_id].update(status="done", result=song, percent=100)
            _emit_job_complete(job_id, song)
        except Exception as e:
            with jobs_lock:
                jobs[job_id].update(status="error", error=str(e))
            _emit_job_error(job_id, str(e))
        finally:
            # Best-effort cleanup of the temp staging dir.
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
                tmp_dir.rmdir()
            except OSError:
                pass

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"job_id": job_id})


@api.route("/jobs/<job_id>")
def job_status(job_id):
    with jobs_lock:
        j = jobs.get(job_id)
    if not j:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id": job_id,
        "status": j.get("status"),
        "stage": j.get("stage"),
        "percent": j.get("percent", 0),
        "message": j.get("message", ""),
        "result": j.get("result"),
        "error": j.get("error"),
    })

# ----- Songs -----

@api.route("/songs")
def list_songs():
    return jsonify({"songs": _list_songs()})

@api.route("/songs/<song_id>")
def get_song(song_id):
    song_dir = get_song_dir(storage, song_id)
    meta_path = song_dir / "song_meta.json"
    if not meta_path.exists():
        return jsonify({"error": "Song not found"}), 404
    with open(meta_path) as f:
        meta = json.load(f)
    meta["notes"] = load_notes().get(song_id, "")
    meta["thumbnail_url"] = f"/api/v1/songs/{song_id}/thumbnail"
    return jsonify(meta)

@api.route("/songs/<song_id>", methods=["DELETE"])
def delete_song(song_id):
    song_dir = get_song_dir(storage, song_id)
    if not song_dir.exists():
        return jsonify({"error": "Song not found"}), 404
    import shutil
    shutil.rmtree(song_dir)
    notes = load_notes()
    notes.pop(song_id, None)
    save_notes(notes)
    return jsonify({"ok": True})

@api.route("/songs/<song_id>/stems/<stem_name>")
def stream_stem(song_id, stem_name):
    """Stream or redirect a stem audio file.

    If the song's meta has stem_urls (R2 / object store), 302-redirect there.
    Otherwise fall back to streaming the local file from ephemeral disk.
    """
    from flask import redirect
    song_dir = get_song_dir(storage, song_id)
    meta_path = song_dir / "song_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            stem_urls = (meta.get("stem_urls") or {})
            if stem_name in stem_urls and stem_urls[stem_name]:
                return redirect(stem_urls[stem_name], code=302)
        except Exception:
            pass
    # Local-disk fallback (legacy + Replicate-path stems)
    stems_dir = song_dir / "stems"
    for ext in ["mp3", "wav", "flac"]:
        p = stems_dir / f"{stem_name}.{ext}"
        if p.exists():
            return send_file(p, mimetype="audio/mpeg" if ext == "mp3" else f"audio/{ext}")
    return jsonify({"error": "Stem not found"}), 404

@api.route("/songs/<song_id>/thumbnail")
def song_thumbnail(song_id):
    song_dir = get_song_dir(storage, song_id)
    thumb = song_dir / "thumbnail.jpg"
    if not thumb.exists():
        return jsonify({"error": "No thumbnail"}), 404
    return send_file(thumb, mimetype="image/jpeg")

@api.route("/songs/<song_id>/reprocess", methods=["POST"])
def reprocess_song(song_id):
    # For v1 we return 501; full impl would re-run Demucs
    return jsonify({"error": "Re-process not implemented in v1"}), 501

@api.route("/songs/<song_id>/snapshots", methods=["GET"])
def get_snapshots(song_id):
    snapshot = get_snapshot(song_id)
    return jsonify({"snapshot": snapshot})

@api.route("/songs/<song_id>/snapshots", methods=["POST"])
def save_snapshot_route(song_id):
    data = request.get_json() or {}
    set_snapshot(song_id, data)
    return jsonify({"ok": True})

@api.route("/songs/<song_id>/notes", methods=["PUT"])
def update_notes(song_id):
    data = request.get_json() or {}
    notes = load_notes()
    notes[song_id] = data.get("notes", "")
    save_notes(notes)
    return jsonify({"ok": True})

# ----- Setlists -----

@api.route("/setlists")
def list_setlists():
    return jsonify({"setlists": load_setlists()})

@api.route("/setlists", methods=["POST"])
def create_setlist():
    data = request.get_json() or {}
    name = data.get("name", "New Setlist")
    color = data.get("color", "#6C63FF")
    setlists = load_setlists()
    new_id = str(uuid.uuid4())
    setlists.append({
        "id": new_id,
        "name": name,
        "color": color,
        "songs": [],
        "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "last_played_at": None,
    })
    save_setlists(setlists)
    return jsonify({"id": new_id, "name": name, "color": color, "songs": []})

@api.route("/setlists/<setlist_id>", methods=["PUT"])
def update_setlist(setlist_id):
    data = request.get_json() or {}
    setlists = load_setlists()
    for s in setlists:
        if s.get("id") == setlist_id:
            s["name"] = data.get("name", s["name"])
            s["color"] = data.get("color", s["color"])
            if "songs" in data:
                s["songs"] = data["songs"]
            save_setlists(setlists)
            return jsonify(s)
    return jsonify({"error": "Setlist not found"}), 404

@api.route("/setlists/<setlist_id>", methods=["DELETE"])
def delete_setlist(setlist_id):
    setlists = [s for s in load_setlists() if s.get("id") != setlist_id]
    save_setlists(setlists)
    return jsonify({"ok": True})
