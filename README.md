# SlicerSmthng

A music practice workstation: paste a YouTube link, AI splits it into stems (vocals, drums, bass, guitar, piano, other), then practice with isolated stems, A/B loops, slowdown, chord detection, and setlists.

**Stack:** Flask + React + Vite + Tailwind. Stem separation runs on a cloud GPU via [Replicate](https://replicate.com); everything else (YouTube download, BPM/key/chord analysis, audio mixing) is local.

For the full product spec, see [`PRD.md`](./PRD.md).

---

## Quick deploy to Render (production)

1. **Get a Replicate API token** at <https://replicate.com/account/api-tokens>. (Pay-as-you-go, ~$0.02 per song with the default `htdemucs` model.)
2. **Push this repo to GitHub.**
3. In the [Render dashboard](https://dashboard.render.com): **New +** → **Blueprint** → pick this repo. Render reads `render.yaml` and provisions a free web service.
4. After the first build, go to the service's **Environment** tab and set `REPLICATE_API_TOKEN` to the token from step 1.
5. Open the URL Render gives you (`https://<your-service>.onrender.com`). Paste a YouTube link, click **Slice It**.

**Free-tier caveats:**
- The service sleeps after 15 min idle and takes ~30 sec to wake on the next request.
- Stems live on the container's ephemeral disk — they're lost on every restart (every code push, every wake from sleep). Fine for personal use; if you want persistence, attach a Render Disk ($0.25/GB/mo) or move stem storage to Cloudflare R2 (10 GB free).

---

## Run locally

### Prerequisites
- Python 3.11 or 3.12
- Node.js 20+
- `ffmpeg` (`brew install ffmpeg` on macOS)
- A Replicate API token

### Steps
```bash
# Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export REPLICATE_API_TOKEN=r8_...

# Frontend (one-time build, then served by Flask)
cd frontend && npm install && npm run build && cd ..

# Run
python server.py
# → http://localhost:8080
```

### Frontend dev mode (hot reload, separate from backend)
```bash
cd frontend && npm run dev   # → http://localhost:5173 (proxies /api to :8080)
# In another terminal: python server.py
```

Vite dev is slow on low-end CPUs (the React + Tailwind hot-reload pipeline is heavy). If you're on an older machine, prefer the production build above.

### Storage location
Stems land at `~/Music/SlicerSmthng/songs/<id>/`. Override with `SLICERSMTHNG_STORAGE=/path` to put them elsewhere.

---

## Project layout

```
backend/             Flask API (routes, Replicate job runner, librosa analysis, data store)
frontend/            Vite + React 19 + TS + Tailwind + Zustand
  src/components/    Layout, PlayerBar, PlayerExpanded, ProcessingModal, SongCard, UrlBar
  src/pages/         Home, Library, Setlists, SetlistDetail, Settings
  src/stores/        playerStore, libraryStore, setlistStore, jobStore
server.py            Flask entry; serves /api/v1/* + built frontend at /
Dockerfile           Multi-stage build (node → python) for Render / any Docker host
render.yaml          Render Blueprint (one-click deploy)
requirements.txt     Python deps (Flask, yt-dlp, replicate, librosa, soundfile)
PRD.md               Full product spec
```

---

## API

All under `/api/v1/`:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/import` | Body `{url, model, format}` → returns `{job_id}` |
| `GET`  | `/jobs/<id>` | Job status + progress |
| `GET`  | `/songs` | List library |
| `GET`  | `/songs/<id>` | Single song meta + chords |
| `DELETE` | `/songs/<id>` | Delete song and stems |
| `GET`  | `/songs/<id>/stems/<name>` | Stream a single stem |
| `GET`  | `/songs/<id>/thumbnail` | YouTube thumbnail |
| `GET`/`POST` | `/songs/<id>/snapshots` | Mix snapshot (volumes, mute/solo, loop, tempo) |
| `PUT`  | `/songs/<id>/notes` | Per-song notes |
| `GET`/`POST` | `/setlists` | List / create |
| `PUT`/`DELETE` | `/setlists/<id>` | Update / delete |

WebSocket events on the same origin (Socket.IO): `job:progress`, `job:complete`, `job:error`.

---

## Roadmap (where this is going)

See [`PRD.md`](./PRD.md) §12. Short version:
- v1: full PRD scope — A/B loop, tempo slowdown, chord timeline, setlists, record-over-stems
- v1.x: per-stem EQ / pan / reverb; chord chart export
- v2: cloud sync, shared setlists, band workspaces
