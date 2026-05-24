# SlicerSmthng — Quickstart

Get the app running and test the main flows in a few minutes.

## Prerequisites

- **Python 3.10+** with `pip`
- **Node.js 18+** and `npm`
- **FFmpeg** (for audio): `brew install ffmpeg` on macOS
- **Demucs** (stem separation): installed via `pip` below

## 1. Backend (API + stem separation)

From the project root:

```bash
# Create and use a virtualenv (recommended)
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server (default port 8080)
python server.py
```

You should see:

- `SlicerSmthng API: http://localhost:8080`
- `API base: http://localhost:8080/api/v1`

Leave this terminal open.

## 2. Frontend (React UI)

In a **second terminal**, from the project root:

```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. The Vite dev server proxies `/api` and `/socket.io` to the backend.

## 3. Give it a test

### Import a song (YouTube → stems)

1. Paste a YouTube URL into the **URL bar** at the top (e.g. a short music video or song).
2. Optionally open **Options** and choose **Model** (e.g. `htdemucs_ft`) and **Format** (MP3 or FLAC).
3. Click **Slice It**.
4. Wait for the processing modal (Downloading → Extracting → AI model → Analyzing → Done). The first run can take several minutes depending on song length and machine.
5. When done, the song appears in **Recent songs** on Home and in **Library**. The **player bar** at the bottom loads the new song.

### Playback and stem mixer

1. Click a **song card** (Home or Library) to load it in the player.
2. Use **Play/Pause**, **seek** (drag the progress bar), and **volume** on the collapsed bar.
3. Click **↑** (expand) to open the **expanded player**:
   - See the **current chord** (if analysis ran).
   - Use **Stem mixer** to mute/solo and set volume per stem (Vocals, Drums, Bass, etc.).
   - Set **Tempo** presets (50%, 75%, 90%, 100%).
   - Set **Loop A** at current position, **Loop B** at end of section, then turn **Loop** on to repeat that section.

### Setlists

1. Go to **Setlists** → **New setlist** → enter a name → **Create**.
2. Open the setlist → **Add song** → pick a song from the library → **Add**.
3. Reorder or remove songs as needed. Use **Back** to return to the setlist list.

### Keyboard shortcuts (in player)

- **Space** — Play / Pause  
- **↑ / ↓** — Master volume (when focused in player area)  
- Loop A/B are set via the expanded player buttons; **[** and **]** can be wired in a future update.

## 4. Optional: single-command run (production-style)

Build the frontend and serve it from the Flask server:

```bash
# Terminal 1: build frontend
cd frontend && npm run build && cd ..

# Terminal 2: run backend (serves built React from /)
python server.py
```

Then open **http://localhost:8080**. No separate Vite process needed.

## 5. Where data lives

- **Songs and stems:** `~/Music/SlicerSmthng/songs/<song_id>/`  
  - `stems/*.mp3` (or .flac), `song_meta.json`, `thumbnail.jpg`
- **Setlists and mix snapshots:** `~/Music/SlicerSmthng/data/`  
  - `setlists.json`, `mix_snapshots.json`, `song_notes.json`

Override the root with the env var:

```bash
SLICERSMTHNG_STORAGE=/path/to/folder python server.py
```

## Troubleshooting

- **Port in use:** The backend tries 8080, 8081, … until one is free. The frontend dev server uses 5173.
- **Demucs / PyTorch slow or failing:** First run will download the model. Use `htdemucs` (faster) instead of `htdemucs_ft` if needed.
- **CORS errors:** Ensure the frontend is opened at the URL Vite shows (e.g. http://localhost:5173) and that the backend is running.
- **No chord / BPM data:** If `librosa` is not installed, the app uses stub BPM/chord data (e.g. 120 BPM, placeholder chords). Install `librosa` and `soundfile` for real analysis:  
  `pip install librosa soundfile`

---

For full product scope and specs, see **PRD.md**.
