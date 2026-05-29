"""Flask API routes for SlicerSmthng (PRD §9.2)."""
import json
import os
import secrets as _secrets
import threading
import uuid
from pathlib import Path
from flask import Blueprint, abort, request, jsonify, send_file

from backend.config import get_storage
from backend.utils import (
    get_song_dir,
    sanitize_filename,
    validate_song_id,
    validate_stem_name,
)
from backend.jobs import run_import, run_import_file
from backend.storage import sync_metas_from_r2, save_song_meta, save_song_lyrics, delete_song_from_r2, r2_status
from backend.metadata import enrich_metadata
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


# ---------------------------------------------------------------------------
# Defense-in-depth: validate every <song_id> / <stem_name> URL parameter
# BEFORE the view runs. Catches path-traversal attempts (`..`, encoded
# slashes, etc.) even in routes that don't go through get_song_dir.
# ---------------------------------------------------------------------------
@api.before_request
def _validate_url_path_args():
    args = request.view_args or {}
    if "song_id" in args:
        validate_song_id(args["song_id"])
    if "stem_name" in args:
        validate_stem_name(args["stem_name"])


# ---------------------------------------------------------------------------
# Internal admin-token gate for the noisy diag endpoints (they leak R2
# object listings + raw boto3 exception strings, both useful for debugging
# but unwanted in front of band members who got past the site password).
# ---------------------------------------------------------------------------
def _require_admin_token():
    expected = os.environ.get("ADMIN_TOKEN", "").strip()
    if not expected:
        return  # token unset = endpoint open (local dev convenience)
    supplied = request.headers.get("X-Admin-Token", "").strip()
    if not supplied or not _secrets.compare_digest(supplied, expected):
        abort(403, description="admin token required")

# Pull any persisted song metadata down from R2 at startup. This rebuilds
# the local song_meta.json cache after a container restart so the library
# isn't empty when the ephemeral disk has been wiped.
try:
    hydrated = sync_metas_from_r2(storage / "songs")
    if hydrated:
        print(f"[storage] hydrated {hydrated} song meta(s) from R2 at startup")
except Exception as e:
    print(f"[storage] startup R2 sync failed (non-fatal): {e}")
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
        # Frontend always asks our backend for thumbnail; we redirect to R2
        # cover.jpg (album art) if present, then YouTube thumbnail, then 404.
        meta["thumbnail_url"] = f"/api/v1/songs/{meta['id']}/thumbnail"
        out.append(meta)
    return sorted(out, key=lambda s: s.get("added_at", ""), reverse=True)


# ----- Diag (used to debug deploy issues without screen-scraping logs) -----

@api.route("/_diag/r2-list")
def diag_r2_list():
    """List up to 50 objects in the R2 bucket. Surfaces auth/permission problems
    that the silent-fallback sync swallows."""
    _require_admin_token()
    import os
    bucket = os.environ.get("R2_BUCKET", "").strip()
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if not (bucket and account_id and access_key and secret_key):
        return jsonify({"error": "R2 env vars missing"}), 500
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
        # First: list all objects (no prefix) so we can see what's there
        resp_all = client.list_objects_v2(Bucket=bucket, MaxKeys=50)
        all_keys = [obj["Key"] for obj in resp_all.get("Contents", [])]
        # Then: list with the songs/ prefix specifically
        resp_songs = client.list_objects_v2(Bucket=bucket, Prefix="songs/", MaxKeys=50)
        songs_keys = [obj["Key"] for obj in resp_songs.get("Contents", [])]
        # Filter to meta-type files
        meta_keys = [k for k in songs_keys if k.endswith("song_meta.json")]
        return jsonify({
            "ok": True,
            "bucket": bucket,
            "total_count_all": resp_all.get("KeyCount", 0),
            "total_count_songs_prefix": resp_songs.get("KeyCount", 0),
            "meta_files_found": len(meta_keys),
            "all_keys_sample": all_keys[:20],
            "songs_keys_sample": songs_keys[:20],
            "meta_keys_sample": meta_keys[:10],
        })
    except Exception as e:
        return jsonify({"error": str(e), "type": type(e).__name__}), 500


@api.route("/_diag/r2-sync")
def diag_r2_sync():
    """Force a sync from R2 to local cache and report what happened."""
    _require_admin_token()
    songs_root = storage / "songs"
    before = sum(1 for d in songs_root.glob("*/song_meta.json")) if songs_root.exists() else 0
    try:
        hydrated = sync_metas_from_r2(songs_root)
    except Exception as e:
        return jsonify({"error": str(e), "type": type(e).__name__}), 500
    after = sum(1 for d in songs_root.glob("*/song_meta.json")) if songs_root.exists() else 0
    return jsonify({
        "ok": True,
        "songs_local_before": before,
        "songs_local_after": after,
        "hydrated": hydrated,
        "storage_root": str(storage),
    })


@api.route("/_diag")
def diag():
    """Operational status. Safe to expose — no secret values returned."""
    songs_root = storage / "songs"
    local_meta_count = 0
    if songs_root.exists():
        for song_dir in songs_root.iterdir():
            if song_dir.is_dir() and (song_dir / "song_meta.json").exists():
                local_meta_count += 1
    return jsonify({
        "storage_root": str(storage),
        "songs_with_local_meta": local_meta_count,
        "r2": r2_status(),
        "separator": (
            "modal" if os.environ.get("STEM_SEPARATOR", "").lower() == "modal"
            else "replicate"
        ),
        "modal_url_set": bool(os.environ.get("MODAL_DEMUCS_URL", "").strip()),
        "ytdlp_proxy_set": bool(os.environ.get("YT_DLP_PROXY", "").strip()),
        "ytdlp_cookies_set": bool(os.environ.get("YT_DLP_COOKIES_B64", "").strip()),
    })

# ----- Import & Jobs -----

@api.route("/import", methods=["POST"])
def import_url():
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    model = data.get("model", "htdemucs")
    quality = data.get("format", "mp3")
    # yt-dlp supports 1,800+ sites (SoundCloud, Bandcamp, Vimeo, Mixcloud,
    # Audius, direct MP3 URLs, ...). We let it decide what's extractable
    # rather than maintain an allow-list. Just require an http(s) URL.
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({"error": "Valid http(s) URL required"}), 400
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
    if song_dir.exists():
        import shutil
        shutil.rmtree(song_dir)
    # Also nuke from R2 (stems + meta + lyrics) so we don't leak storage.
    try:
        delete_song_from_r2(song_id)
    except Exception as e:
        print(f"[delete_song] R2 cleanup for {song_id} failed: {e}")
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

@api.route("/songs/<song_id>/meta", methods=["PUT"])
def update_song_meta(song_id):
    """Edit a song's title/artist + cascade re-fetch of derived data.

    On save we:
      - update title + artist in song_meta.json (locally + R2)
      - delete the lyrics cache so next /lyrics call queries LRCLib fresh
      - drop the cover_url + delete local cover.jpg so the new artist's
        album art is fetched on next request
      - try to fetch a new cover from iTunes Search (best-effort)
    """
    from backend.metadata import fetch_album_art_url
    from backend.storage import save_song_cover_art

    payload = request.get_json() or {}
    new_title = (payload.get("title") or "").strip()
    new_artist = (payload.get("artist") or "").strip()
    if not new_title:
        return jsonify({"error": "title is required"}), 400

    song_dir = get_song_dir(storage, song_id)
    meta_path = song_dir / "song_meta.json"
    if not meta_path.exists():
        return jsonify({"error": "Song not found"}), 404
    with open(meta_path) as f:
        meta = json.load(f)

    meta["title_original"] = meta.get("title_original") or meta.get("title")
    meta["artist_original"] = meta.get("artist_original") or meta.get("artist")
    meta["title"] = new_title
    meta["artist"] = new_artist or meta.get("artist", "Unknown")
    meta["metadata_source"] = "user-edit"
    meta["metadata_confidence"] = 100  # user said so

    # Invalidate lyrics cache + cover so they get refetched with new title/artist
    try:
        (song_dir / "lyrics.json").unlink()
    except OSError:
        pass
    try:
        (song_dir / "cover.jpg").unlink()
    except OSError:
        pass
    meta["cover_url"] = None

    # Best-effort cover refresh
    try:
        art_url = fetch_album_art_url(new_title, meta["artist"])
        if art_url:
            new_cover = save_song_cover_art(song_id, art_url, song_dir / "cover.jpg")
            if new_cover:
                meta["cover_url"] = new_cover
    except Exception as e:
        print(f"[update_song_meta] cover refresh failed: {e}")

    save_song_meta(song_id, meta, meta_path)

    # Add thumbnail URL for frontend convenience
    meta["thumbnail_url"] = f"/api/v1/songs/{song_id}/thumbnail"
    meta["notes"] = load_notes().get(song_id, "")
    return jsonify(meta)


@api.route("/songs/<song_id>/lyrics")
def get_song_lyrics(song_id):
    """Fetch (and cache) lyrics for a song from LRCLib (free, open API).

    Returns shape:
        { "synced": "[00:12.34]line of lyrics\\n[...]" | null,
          "plain":  "full lyrics as one string"        | null,
          "source": "lrclib" | null,
          "not_found": bool }

    Synced lyrics are in LRC format — the frontend parses them and lines
    light up in time with the audio engine's currentTime.
    """
    song_dir = get_song_dir(storage, song_id)
    meta_path = song_dir / "song_meta.json"
    if not meta_path.exists():
        return jsonify({"error": "Song not found"}), 404
    with open(meta_path) as f:
        meta = json.load(f)

    # Cache check — lyrics.json sits next to song_meta.json
    lyrics_path = song_dir / "lyrics.json"
    if lyrics_path.exists():
        with open(lyrics_path) as f:
            return jsonify(json.load(f))

    # Build LRCLib query
    import urllib.error
    import urllib.parse
    import urllib.request

    title = (meta.get("title") or "").strip()
    artist = (meta.get("artist") or "").strip()
    duration = int(meta.get("duration") or 0)
    if not title:
        return jsonify({"error": "No title in song meta — can't search lyrics"}), 400

    # If this song hasn't been MusicBrainz-enriched yet (or the previous
    # match was low-confidence), do it now. Bad filenames usually have bad
    # lyric search results too; correcting the metadata here makes "Find
    # lyrics" work as a one-click clean-up for older imports.
    already_enriched = (
        meta.get("metadata_source") == "musicbrainz"
        and int(meta.get("metadata_confidence") or 0) >= 75
    )
    if not already_enriched:
        enriched = enrich_metadata(title, artist if artist.lower() != "uploaded" else "")
        if enriched.get("source") == "musicbrainz":
            # Persist the correction back to both local and R2
            meta["title_original"] = meta.get("title_original") or title
            meta["artist_original"] = meta.get("artist_original") or artist
            meta["title"] = enriched["title"]
            meta["artist"] = enriched["artist"]
            meta["metadata_source"] = enriched["source"]
            meta["metadata_confidence"] = enriched["confidence"]
            save_song_meta(song_id, meta, meta_path)
            title = enriched["title"]
            artist = enriched["artist"]
            # Invalidate cached lyrics — they were searched with bad metadata
            try:
                if (song_dir / "lyrics.json").exists():
                    (song_dir / "lyrics.json").unlink()
            except OSError:
                pass

    params = {"track_name": title, "artist_name": artist}
    if duration > 0:
        params["duration"] = str(duration)
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"https://lrclib.net/api/get?{qs}",
        headers={
            "User-Agent": "SlicerSmthng/1.0 (+https://slicersmthng.onrender.com)",
            "Accept": "application/json",
        },
    )

    result: dict
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = {
            "synced": data.get("syncedLyrics"),
            "plain": data.get("plainLyrics"),
            "source": "lrclib",
            "not_found": False,
            "instrumental": bool(data.get("instrumental")),
        }
    except urllib.error.HTTPError as e:
        if e.code == 404:
            result = {"synced": None, "plain": None, "source": None,
                      "not_found": True, "instrumental": False}
        else:
            return jsonify({"error": f"LRCLib HTTP {e.code}"}), 502
    except Exception as e:
        return jsonify({"error": f"LRCLib unreachable: {e}"}), 502

    # Cache (both locally and on R2)
    save_song_lyrics(song_id, result, lyrics_path)
    # Echo back the (possibly corrected) title + artist so the frontend can
    # update what it's showing without a full song re-fetch.
    return jsonify({**result, "title": title, "artist": artist})


@api.route("/songs/<song_id>/thumbnail")
def song_thumbnail(song_id):
    """Album art > YouTube thumbnail > 404 (frontend falls back to a Music icon)."""
    from flask import redirect
    song_dir = get_song_dir(storage, song_id)
    meta_path = song_dir / "song_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            cover = meta.get("cover_url")
            if cover:
                return redirect(cover, code=302)
        except Exception:
            pass
    # Local cover.jpg fallback (when R2 isn't configured but iTunes still hit)
    local_cover = song_dir / "cover.jpg"
    if local_cover.exists():
        return send_file(local_cover, mimetype="image/jpeg")
    # Legacy YouTube thumbnail
    thumb = song_dir / "thumbnail.jpg"
    if thumb.exists():
        return send_file(thumb, mimetype="image/jpeg")
    return jsonify({"error": "No thumbnail"}), 404


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
