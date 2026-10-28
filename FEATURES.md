# SlicerSmthng — Feature Summary

Quick overview of what’s implemented per the PRD (v2).

---

## 1. YouTube import and processing

- **URL bar** at the top of every screen; paste YouTube URL (including Cmd+V).
- **YouTube search** from the same bar: type words instead of a link, press Enter, pick a result to slice it (yt-dlp `ytsearch`, `GET /api/v1/search`).
- **Options:** Model (`htdemucs`, `htdemucs_ft`, `htdemucs_6s`) and format (MP3 320kbps / FLAC).
- **“Slice It”** starts the job; **processing modal** shows stages (Validating → Downloading → Extracting → Separating → Analyzing → Finalizing) and progress.
- **WebSocket** (SocketIO) for live job progress; fallback **polling** if WebSocket isn’t available.
- On completion, the new song appears in the library and loads in the player.

---

## 2. Stem separation engine (backend)

- **Demucs** (htdemucs, htdemucs_ft, htdemucs_6s) for 4 or 6 stems (vocals, drums, bass, other; optional guitar, piano).
- Output layout: `~/Music/SlicerSmthng/songs/<song_id>/stems/*.mp3`, `song_meta.json`, `thumbnail.jpg`.
- **Post-analysis:** BPM/key/chord detection (librosa when installed; otherwise stub values). Results stored in `song_meta.json`.

---

## 3. Player (collapsed bar)

- **Persistent bottom bar** (80px): thumbnail, title, artist, BPM/Key pills, transport (prev, -10s, play/pause, +10s, next), progress bar (seekable), loop toggle, expand, master volume.
- **Expand** opens the full player overlay.

---

## 4. Expanded player

- **Header:** Thumbnail, title, artist, BPM, key, collapse button.
- **Chord strip:** Current chord shown (from `song_meta.json` chords).
- **Stem mixer grid:** One card per stem (vocals, drums, bass, guitar, piano, other) with:
  - Solo (S) / Mute (M)
  - Volume fader
  - Color-coded left border (PRD stem colors).
- **Tempo presets:** 50%, 75%, 90%, 100% (UI; server-side time-stretch can be added later).
- **A/B loop:** Set A at current time, B at current time, toggle loop on/off. Loop state and markers shown.

---

## 5. A/B loop and slowdown

- **A/B loop:** Set loop start (A) and end (B) from expanded player; loop toggle in collapsed bar. Playback repeats between A and B when loop is on.
- **Tempo:** Preset buttons 50–100% in expanded player (UI in place; actual time-stretch can use server-side pre-renders or Web Audio later).

---

## 6. Chord detection and timeline

- **Backend:** Chords (and BPM/key) written to `song_meta.json` during import (librosa or stub).
- **Frontend:** Current chord displayed in the expanded player; chord strip can be extended to show timeline and click-to-seek.

---

## 7. Setlists

- **Setlist list:** Create, name, and color setlists; view song count.
- **Setlist detail:** Add/remove songs from library; list order is the play order.
- **Data:** Stored in `~/Music/SlicerSmthng/data/setlists.json`.

---

## 8. Library and song management

- **Library:** Grid or list view; search by title/artist; click a song to load in the player.
- **Song card:** Thumbnail, title, artist, BPM/Key badges, stem dots, duration; click to play.
- **API:** List songs, get song, delete song, stream stems and thumbnail.

---

## 9. Mix snapshots

- **Backend:** `POST /api/v1/songs/:id/snapshots` saves a mix snapshot (stems, tempo, loop, etc.); `GET` returns the latest.
- **Frontend:** Snapshot can be saved when leaving a song or changing mix; setlist playback can restore per-song snapshot (hook-up in UI can be completed as needed).

---

## 10. Record over stems / per-stem effects

- **Record over stems:** Not implemented in this pass (PRD §6.7).
- **Per-stem effects:** Volume, mute, solo are in place; EQ/Pan/Reverb (PRD §6.9) are not yet implemented.

---

## 11. Keyboard shortcuts

- **Space** — Play/Pause (when focus is in player area).
- **↑ / ↓** — Master volume (when applicable).
- **[** / **]** — Intended for loop A/B (can be wired in player component).
- **Escape** — Can be used to collapse expanded player (can be wired).

---

## 12. Design system (PRD §7)

- **Colors:** Backgrounds (deepest, deep, card, elevated), primary (indigo), accent (cyan, amber, red), stem colors (vocals, drums, bass, guitar, piano, other), text and borders.
- **Typography:** Inter for UI; scale and weights as in PRD.
- **Layout:** Sidebar (240px), main content, persistent player bar; expanded player ~72vh from bottom.
- **Motion:** CSS transitions and simple animations (e.g. slide-up for expanded player).

---

## 13. Technical stack

- **Backend:** Flask, Flask-CORS, Flask-SocketIO; REST under `/api/v1/`; yt-dlp, Demucs, optional librosa.
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Zustand, React Router, Socket.IO client.
- **Audio:** Single-stem playback (first stem) via HTMLAudioElement; multi-stem sync and time-stretch can be added with Web Audio API and/or server-rendered stems.

---

## Not in this implementation (optional next steps)

- Waveform visualizer (e.g. WaveSurfer.js).
- Full multi-stem Web Audio mix (all stems in sync with individual gain/mute/solo).
- Server-side time-stretch (50%/75%/90% pre-rendered files).
- Record over stems (mic input, “My Take” stem).
- Per-stem EQ, pan, reverb.
- Chord chart export (PDF/print).
- Lottie animations for processing/success/empty states.
- Re-process song from UI.

Use **QUICKSTART.md** to run and test the app end to end.
