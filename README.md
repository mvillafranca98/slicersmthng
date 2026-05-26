# SlicerSmthng

A music practice workstation: paste a YouTube link, AI splits it into stems (vocals, drums, bass, guitar, piano, other), then practice with isolated stems, A/B loops, slowdown, chord detection, and setlists.

**Stack:** Flask + React + Vite + Tailwind. Stem separation runs on a cloud GPU via [Modal](https://modal.com) (free $30/mo credit) or [Replicate](https://replicate.com) (pay-as-you-go). Audio is fetched via yt-dlp, which natively supports SoundCloud, Bandcamp, YouTube, Vimeo, Mixcloud, Audius, and ~1,800 other sites. Or just drop in any MP3/WAV/FLAC/M4A file directly.

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

### Persistent stem storage on Cloudflare R2 (recommended)

Render's container disk is ephemeral — songs get wiped on every code push and every container restart. To keep your library between deploys, configure Cloudflare R2 (free up to 10 GB, ~$0.015/GB/mo after, zero egress fees):

1. Sign up at <https://dash.cloudflare.com> (free, no card).
2. Sidebar **R2** → **Create bucket**. Name it `slicersmthng-stems` (or anything). Choose a region.
3. In the bucket → **Settings** → **Public access** → **Allow public access**. Copy the **R2.dev URL** (looks like `https://pub-xxxxxxxxxxxx.r2.dev`).
4. Sidebar **R2** → **Manage R2 API Tokens** → **Create API Token**. Permissions: **Object Read & Write**. Scope to your bucket. Copy the **Access Key ID** + **Secret Access Key** + **Account ID**.

Then on **Modal** (where stems get uploaded directly to save bandwidth):
```bash
modal secret create r2-credentials \
    R2_ACCOUNT_ID=<your account id> \
    R2_ACCESS_KEY_ID=<your r2 access key> \
    R2_SECRET_ACCESS_KEY=<your r2 secret> \
    R2_BUCKET=<your bucket name> \
    R2_PUBLIC_URL_BASE=https://pub-<id>.r2.dev   # NO trailing slash
modal deploy modal_demucs.py
```

And on **Render** (so the backend can build URLs for the stem-redirect endpoint), set the same 5 env vars in the service's Environment tab. Save → Render redeploys → songs slicked from now on get uploaded to R2 and survive forever.

Existing songs from before R2 was wired stay on local disk and continue to work (the stem endpoint falls through to local files when no `stem_urls` is in the meta).

---

### Stem separator: Replicate (paid) or Modal (free)

The backend can talk to either:
- **Replicate** (default) — pay-as-you-go, ~$0.02/song with `htdemucs`. Need to add credit at <https://replicate.com/account/billing>. Set `REPLICATE_API_TOKEN`.
- **Modal** (free up to $30/mo of compute, ~1,600 free song separations) — set `STEM_SEPARATOR=modal` and `MODAL_DEMUCS_URL=<your modal endpoint>`.

To use Modal:

```bash
pip install modal
modal token new                # opens browser to authenticate (no card needed)
modal deploy modal_demucs.py   # builds the image + deploys, prints a URL
```

Take the URL Modal prints (looks like `https://<username>--slicersmthng-demucs-separate.modal.run`) and set it as `MODAL_DEMUCS_URL` on Render, alongside `STEM_SEPARATOR=modal`. Save → Render redeploys → stem separation now runs free on Modal's GPU.

### YouTube on a cloud host

YouTube blocks most datacenter IPs and asks for "sign in to confirm you're not a bot." There are three layers of defense built in:

1. **yt-dlp impersonation** (automatic). The backend tries `web` → `mweb` → `web_safari` clients in order, with a realistic Safari User-Agent. Sometimes that's enough.
2. **Logged-in cookies** (recommended). Export your YouTube cookies from a logged-in Chrome session — the "Get cookies.txt LOCALLY" extension does this in one click. Then:
   ```bash
   # On your Mac:
   base64 -i ~/Downloads/youtube.com_cookies.txt | pbcopy
   ```
   On Render → service → **Environment** → add `YT_DLP_COOKIES_B64` with the clipboard contents. Save → redeploys. Cookies typically last 1–4 weeks; refresh when you start seeing the bot interstitial again.
3. **Audio file upload** (escape hatch). The UrlBar has an upload button next to it that accepts MP3/WAV/FLAC/M4A directly — bypasses YouTube entirely. Useful for songs not on YouTube, age-restricted videos, or when you don't want to deal with cookies.
4. **Residential proxy** (most reliable for a real public deploy). Set `YT_DLP_PROXY` to a proxy URL — e.g. `http://user:pass@residential.example.com:8080`. Routes yt-dlp's requests through a real ISP IP that YouTube doesn't flag. Cheap residential proxies exist ($3–5/mo on Proxy-Cheap, IPRoyal, Webshare). This is what commercial competitors (Moises, Fadr) actually do — there's no free bypass that lasts forever.

**Why cookies sometimes fail even when set:** YouTube cross-references the cookie's origin geography with the IP making the request. Cookies set in (say) Mexico hitting YouTube from an Oregon datacenter IP look like account hijacking to their fraud detection. Datacenter IPs + valid account cookies = often rejected. A residential proxy in roughly the same region as where the cookies were created tends to work better.

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
