# SlicerSmthng — Product Requirements Document
**Version:** 2.0 (Full Redesign)
**Date:** February 2026
**Stack:** Python/Flask (backend) + React 18 + Tailwind CSS (frontend)

---

## Table of Contents
1. [Product Vision](#1-product-vision)
2. [Problem Statement](#2-problem-statement)
3. [User Personas](#3-user-personas)
4. [Goals & Success Metrics](#4-goals--success-metrics)
5. [Information Architecture](#5-information-architecture)
6. [Feature Specifications](#6-feature-specifications)
   - 6.1 YouTube Import & Processing
   - 6.2 Stem Separation Engine
   - 6.3 The SlicerSmthng Player
   - 6.4 A/B Loop & Slowdown
   - 6.5 Chord Detection & Timeline
   - 6.6 Setlists
   - 6.7 Record Over Stems
   - 6.8 Library & Song Management
   - 6.9 Per-Stem Effects
   - 6.10 Keyboard Shortcuts
7. [Design System & UI Spec](#7-design-system--ui-spec)
   - 7.1 Color Palette
   - 7.2 Typography
   - 7.3 Spacing & Layout Grid
   - 7.4 Component Library
   - 7.5 Lottie Animation Spec
   - 7.6 Motion & Transitions
8. [Media Player Deep Spec](#8-media-player-deep-spec)
   - 8.1 Collapsed Player Bar
   - 8.2 Expanded Player View
   - 8.3 Waveform Visualizer
   - 8.4 Chord Timeline Strip
   - 8.5 Stem Mixer Grid
9. [Technical Architecture](#9-technical-architecture)
   - 9.1 System Overview
   - 9.2 Backend API
   - 9.3 Frontend State Management
   - 9.4 Audio Engine
   - 9.5 Data Models
10. [Screen-by-Screen UX Flows](#10-screen-by-screen-ux-flows)
11. [Accessibility](#11-accessibility)
12. [Roadmap](#12-roadmap)
13. [Out of Scope for v1](#13-out-of-scope-for-v1)

---

## 1. Product Vision

**SlicerSmthng** is a local-first music practice workstation for musicians who learn by ear. It bridges the gap between passive listening and active practice: paste a YouTube link, and within minutes you have a fully interactive multi-track session — isolated stems, detected chords, adjustable tempo, and a loop-ready player — organized into setlists that mirror a real rehearsal workflow.

Where tools like Fadr.com stop at stem isolation, SlicerSmthng continues into the practice room. Where audio editors like Audacity require expertise, SlicerSmthng requires only curiosity.

**North Star:** A guitarist, bassist, keyboardist, or vocalist should be able to paste a link, hit play, solo their instrument, loop the hard section, slow it to 70%, and have the chord names scrolling overhead — all without leaving a single screen.

---

## 2. Problem Statement

Musicians learning a new song face a fragmented, friction-heavy workflow:

| Step | Current Pain |
|---|---|
| Get the audio | Manually visit y2mate, yt-dlp, or similar — often blocked or limited |
| Isolate your instrument | Either pay for Moises/Fadr monthly subscription or run Demucs manually in a terminal |
| Practice a hard section | Scrub manually in VLC or Audacity, try to set loop points clumsily |
| Slow it down | Open a separate app (Amazing Slow Downer costs $10), re-import audio |
| See the chords | Open a browser tab to Ultimate Guitar (often wrong, often paywalled) |
| Organize by setlist | Maintain a folder structure manually; settings never saved |
| Practice all songs in one session | Reload each song from scratch, re-configure stems each time |

**SlicerSmthng collapses all of these into one app, running entirely on your machine, with no subscriptions.**

---

## 3. User Personas

### Persona A — "Marco", the Cover Band Guitarist
- 28 years old, plays in a weekend cover band
- Needs to learn 15+ songs before every gig
- Pain: Spends 2 hours per song just setting up to practice
- Uses: YouTube, Ultimate Guitar, Spotify
- Goal: "I just want to hear the guitar part clearly and loop the solo until I've got it"

### Persona B — "Sofia", the Music Student
- 21, studying jazz piano at a conservatory
- Transcribes solos and chord progressions for assignments
- Pain: Chord detection on apps is often wrong for complex jazz harmonies
- Goal: "I need to hear just the piano, and see the chords auto-labeled so I can verify them by ear"

### Persona C — "Dev", the Home Studio Producer
- 35, produces and records original music as a side hustle
- References commercial tracks to analyze arrangement and mixing
- Pain: Wants to mute drums and listen just to how the low-end sits in a specific section
- Goal: "Let me loop bars 8-16 and toggle stems on and off in real time"

### Persona D — "Yuki", the Vocalist
- 24, singer in a band who practices harmonies
- Pain: Wants to hear just the vocal stem and slow it down to learn melismatic runs
- Goal: "I want the lyrics section with just the vocal stem, slowed to 75%, looping the chorus"

---

## 4. Goals & Success Metrics

### v1 Launch Goals
- Time from YouTube URL to playback-ready stems: **< 5 minutes** on Apple Silicon
- User can configure A/B loop, tempo, and stem mix in **< 30 seconds** after a song loads
- Chord timeline accuracy on pop/rock: **> 75%** (as measured by manual comparison to verified sources)
- Setlist playback is seamless: song transitions restore saved stem configurations **100%** of the time

### Engagement Metrics (post-launch)
- Average session length > 45 minutes (reflects practice use, not passive listening)
- % of users who create a setlist within first 3 sessions > 40%
- % of users who use A/B loop per session > 60%

---

## 5. Information Architecture

```
SlicerSmthng
│
├── Home / Dashboard
│   ├── Quick Import (URL bar, prominent)
│   ├── Recent Songs (last 5)
│   └── Quick Access Setlists
│
├── Library
│   ├── All Songs (grid/list toggle)
│   ├── Filter: By instrument count, date added, difficulty
│   └── Search
│
├── Setlists
│   ├── All Setlists
│   ├── Create / Edit Setlist
│   └── Active Setlist view
│
├── Player (persistent bottom bar, expandable overlay)
│   ├── Collapsed Bar (always visible)
│   └── Expanded Overlay
│       ├── Waveform + A/B Loop
│       ├── Chord Timeline Strip
│       ├── Stem Mixer Grid
│       ├── Tempo / Pitch Controls
│       └── Notes Sidebar
│
└── Settings
    ├── Audio Output Device
    ├── Default Separation Model
    ├── Storage Location
    └── Keyboard Shortcuts
```

---

## 6. Feature Specifications

---

### 6.1 YouTube Import & Processing

**Entry Points:**
- Persistent URL bar at the top of every screen (like Spotify's search, always accessible)
- Drag-and-drop a YouTube URL from the browser
- Paste a URL from clipboard via keyboard shortcut `Cmd+V` anywhere in app

**Processing Flow:**
1. URL validation → display YouTube thumbnail + title + duration immediately via oEmbed
2. Model selector: `htdemucs` (fast, 4 stems) / `htdemucs_ft` (best quality, 4 stems) / `htdemucs_6s` (6 stems: adds guitar + piano)
3. Quality selector: MP3 320kbps / FLAC
4. "Slice It" CTA button — large, primary, with a short idle Lottie animation on hover
5. Processing screen (full modal overlay):
   - Lottie animation: waveform splitting into colored bands (each color matching a stem)
   - Stage indicators: Downloading → Extracting Audio → Running AI Model → Analyzing Key+BPM+Chords → Finalizing
   - Estimated time remaining (calculated from song duration × model speed benchmarks)
   - Cancel button always visible
6. On completion: success Lottie burst → song card slides into the Library grid → player auto-loads the new song

**Error Handling:**
- Age-restricted or region-blocked video: clear error with suggestion to try a different upload
- No audio track found: explain and exit gracefully
- Model fails mid-run: retain partial output, show which stems succeeded

---

### 6.2 Stem Separation Engine

**Backend:** Meta Demucs (Python, existing venv retained)

**Stems per model:**
| Model | Stems |
|---|---|
| htdemucs | vocals, drums, bass, other |
| htdemucs_ft | vocals, drums, bass, other |
| htdemucs_6s | vocals, drums, bass, guitar, piano, other |

**Post-separation analysis pipeline (new in v2):**
- BPM detection: `librosa.beat.beat_track()` on the "other" or "bass" stem
- Key detection: `librosa.key` or Essentia's `KeyExtractor` on the full mix
- Chord detection: `madmom` chord recognition pipeline OR `autochord` library — run on piano or guitar stem if available, otherwise on full mix
- All metadata saved to a `song_meta.json` alongside the stems

**Stem file naming convention:**
```
~/Music/SlicerSmthng/{safe_song_title}/{song_id}/
  ├── stems/
  │   ├── vocals.mp3
  │   ├── drums.mp3
  │   ├── bass.mp3
  │   ├── guitar.mp3      (htdemucs_6s only)
  │   ├── piano.mp3       (htdemucs_6s only)
  │   └── other.mp3
  ├── thumbnail.jpg
  └── song_meta.json      ← BPM, key, chords[], duration, youtube_url, model_used
```

---

### 6.3 The SlicerSmthng Player

The player is the heart of the app. It exists in two states:

**Collapsed Player Bar** — persistent, always at the bottom of every screen (80px height). Contains:
- Song thumbnail (40×40px rounded square)
- Song title + artist (truncated with ellipsis)
- BPM badge + Key badge (e.g., `♩ 124` · `F# min`)
- Transport: previous track | rewind 10s | play/pause | forward 10s | next track
- Loop toggle (A/B mode on/off)
- Elapsed / Total time
- Master volume slider

**Expanded Player Overlay** — clicking the waveform icon or pressing Space-up expands the player to fill ~70% of the viewport (slides up from bottom with spring animation). Full spec in Section 8.

---

### 6.4 A/B Loop + Slowdown

**A/B Loop:**
- Two draggable markers on the waveform: A (loop start) and B (loop end)
- Keyboard shortcuts: `[` sets A at current position, `]` sets B at current position
- Loop region highlighted in a translucent colored band on the waveform
- When loop is active, playhead snaps back to A when it reaches B
- Loop can span across beats shown on the chord timeline (beat lines visible on waveform)
- Loop region shows its duration in bars (e.g., "4 bars" when BPM is detected)
- "Clear loop" button resets both markers

**Slowdown (Time Stretch):**
- Tempo control: slider from 50% to 120%, with preset buttons at 50%, 70%, 75%, 80%, 90%, 100%
- Uses Web Audio API `AudioBuffer` pitch-neutral time stretching (Tone.js `Player` with `playbackRate` + pitch compensation via `PitchShift`)
- Pitch does NOT change when slowing down (time-stretch, not pitch-shift)
- Alternatively: process server-side with `librosa.effects.time_stretch` and cache the result at each speed preset
- BPM display updates dynamically to reflect the slowed tempo (e.g., 120 BPM at 75% → shows "90 BPM (75%)")
- Preferred approach for v1: server-side pre-render at 50%, 75%, 90% speeds and serve as alternate audio files (simpler, guaranteed quality)

**Pitch Transposition (bonus, low priority v1):**
- Semitone shift: -6 to +6 semitones, integer steps only
- Displayed as: "−2 st" or "+3 st" or "Concert Pitch"
- Useful for vocalists or players with non-standard tuning

---

### 6.5 Chord Detection & Timeline

**Detection:**
- Run at processing time (not real-time), using `madmom` or `autochord` Python library
- Chord data stored in `song_meta.json` as an array:
  ```json
  "chords": [
    { "time": 0.0,   "chord": "Am" },
    { "time": 2.14,  "chord": "F" },
    { "time": 4.28,  "chord": "C" },
    { "time": 6.42,  "chord": "G" }
  ]
  ```
- Chord names follow standard notation: `Am`, `F`, `Cmaj7`, `G/B`, `Bdim`, etc.

**Chord Timeline Strip (in player):**
- Horizontal scrolling strip positioned immediately below the waveform
- Current chord is center-anchored and displayed large (24px, bold)
- Upcoming chords are visible to the right in decreasing opacity
- Past chords are visible to the left in muted color
- Strip auto-scrolls locked to playhead position
- Chord labels are clickable: clicking a chord label jumps playhead to that chord's timestamp
- When slowdown is active, chord scroll rate adjusts proportionally

**Chord Chart Export:**
- "Export Chord Chart" button in the song detail panel
- Generates a printable single-page PDF (or HTML printable view) with:
  - Song title, BPM, key
  - Chords arranged in measure rows (4/4 assumed, adjustable)
  - Measure numbers for reference

---

### 6.6 Setlists

**Concept:** A setlist is an ordered collection of songs, each with a saved "mix snapshot" — the stem configuration (volumes, muted/soloed state) that the user last used for that song.

**Setlist List Screen:**
- Grid of setlist cards, each showing:
  - Custom name (editable inline)
  - Song count
  - Total duration
  - Color tag (user-assignable from 8 palette options)
  - Last played date
- "New Setlist" creates an empty setlist and enters edit mode

**Setlist Edit View:**
- Drag-and-drop reordering of songs
- "Add song" opens a search/filter modal over the library
- Each song row shows: thumbnail, title, duration, stem count, and "configure" icon that opens the player in that song's saved mix
- Remove song from setlist without deleting from library

**Setlist Playback Mode:**
- Triggered by "Play Setlist" from the setlist view
- When a song ends, the next song loads automatically with a 1-second crossfade silence gap
- Mix snapshot is restored for each song as it loads (correct stems muted/leveled)
- A small "setlist queue" sidebar in the expanded player shows upcoming songs with drag-to-reorder capability
- "Repeat setlist" and "shuffle" toggles in the player transport

**Mix Snapshot:**
- Saved automatically when the user leaves a song or moves to the next
- Schema:
  ```json
  {
    "song_id": "abc123",
    "stems": {
      "vocals":  { "volume": 0.0,  "muted": true,  "solo": false },
      "drums":   { "volume": 0.85, "muted": false, "solo": false },
      "bass":    { "volume": 1.0,  "muted": false, "solo": true  },
      "guitar":  { "volume": 0.6,  "muted": false, "solo": false }
    },
    "tempo_percent": 75,
    "loop_a": 14.2,
    "loop_b": 28.6,
    "loop_active": true
  }
  ```

---

### 6.7 Record Over Stems

**Concept:** The user can arm a microphone input and record themselves playing over the current stem mix, then immediately play back the result.

**Flow:**
1. Tap the microphone icon in the player toolbar
2. Prompt: select input device (uses Web Audio API `getUserMedia`)
3. Input level meter appears (vertical VU meter with peak indicator)
4. "Arm" button: arms record, waits for user to press play
5. When playback starts, recording begins simultaneously with a pre-roll countdown (1 bar of metronome clicks at detected BPM)
6. Recording indicator: pulsing red dot on the player bar + Lottie animation (microphone with concentric ripple rings)
7. On stop: recording saved as a new audio file alongside the stems (`recording_01.mp3`, etc.)
8. Recording appears as a new "stem card" in the mixer (labeled "My Take", colored amber)
9. User can: mute/solo, adjust volume, re-record, or export the recording
10. Export: renders a mixed-down MP3 of all active stems + the recording

**Input Monitoring:**
- Option to hear yourself in the headphones with adjustable latency compensation
- Latency offset setting in Settings → Audio

---

### 6.8 Library & Song Management

**Library Grid View:**
- Masonry card grid, each card showing:
  - YouTube thumbnail (16:9, rounded corners)
  - Song title + channel name (artist)
  - Duration
  - BPM + Key badges
  - Stem count (e.g., "6 stems")
  - Color-coded stem dots to indicate which stems are available
  - "Added X days ago" timestamp
  - Quick-action icons on hover: Play, Add to Setlist, Delete

**Library List View:**
- Dense table format for users with large libraries
- Columns: Title, Artist, Duration, BPM, Key, Stems, Date Added
- Click row to load song

**Filters & Sort:**
- Filter by: stems available, key, BPM range, date range, setlist membership
- Sort by: date added, title, duration, most-practiced

**Search:**
- Full-text search by title or artist
- Real-time results as user types

**Song Detail Panel (slide-in from right):**
- Larger thumbnail
- Full metadata (BPM, key, duration, model used, date added)
- Chord chart preview (scrollable)
- Setlists this song belongs to
- Notes field (freeform text, saved locally)
- "Re-process" button (re-run Demucs, useful if a newer model is available)
- "Delete" button (with confirmation modal)

---

### 6.9 Per-Stem Effects

**Available in the expanded player, per stem:**

| Effect | Controls | Notes |
|---|---|---|
| Volume | 0–100% fader | Existing feature, keep |
| Pan | L–R knob | Left-right stereo placement |
| 3-Band EQ | Bass / Mid / Treble ±12dB | Implemented via Web Audio API BiquadFilterNodes |
| Reverb | Dry/Wet 0–100% | ConvolverNode with a short room IR |
| Pitch Fine-Tune | ±50 cents | For stems that were slightly off-pitch after separation |

**EQ Visualization:**
- Mini frequency response curve (50-wide SVG) that updates in real time as EQ knobs move
- Preset EQ curves per stem type: e.g., "Guitar clarity" preset boosts 2kHz, cuts 200Hz

---

### 6.10 Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `[` | Set loop point A |
| `]` | Set loop point B |
| `L` | Toggle loop on/off |
| `←` / `→` | Seek ±10 seconds |
| `Shift+←` / `Shift+→` | Seek ±1 bar (at detected BPM) |
| `↑` / `↓` | Master volume ±5% |
| `M` | Mute focused stem |
| `S` | Solo focused stem |
| `1`–`6` | Focus stem 1–6 (Tab to cycle) |
| `Cmd+Z` | Undo last stem mix change |
| `Cmd+E` | Expand / collapse player |
| `Cmd+N` | New setlist |
| `Cmd+V` | Paste YouTube URL anywhere |
| `Escape` | Close any modal / collapse player |

---

## 7. Design System & UI Spec

---

### 7.1 Color Palette

**Backgrounds:**
```
--bg-deepest:    #090B10   (app shell, nav)
--bg-deep:       #0D1017   (main content area)
--bg-card:       #141820   (cards, panels)
--bg-elevated:   #1C2230   (modals, tooltips, hover states)
--bg-glass:      rgba(20, 24, 32, 0.72) + blur(16px)  (glassmorphism panels)
```

**Primary / Accent:**
```
--primary:       #6C63FF   (electric indigo — CTAs, active states)
--primary-hover: #8B85FF
--primary-glow:  rgba(108, 99, 255, 0.35)
--accent-cyan:   #00E5FF   (secondary accent — progress bars, waveform)
--accent-amber:  #FFB347   (recording state, warning, "My Take" stem)
--accent-red:    #FF4E6A   (errors, critical actions, record button)
```

**Stem Colors (consistent across the entire app):**
```
--stem-vocals:  #FF6B8A    (coral pink)
--stem-drums:   #FFB347    (warm amber)
--stem-bass:    #00E5C3    (teal)
--stem-guitar:  #5BDB6B    (fresh green)
--stem-piano:   #C47FFF    (violet)
--stem-other:   #8899AA    (cool grey)
--stem-mytake:  #FFD166    (golden — recorded takes)
```

**Text:**
```
--text-primary:   #F0F4FF
--text-secondary: #8899BB
--text-muted:     #4A5568
--text-inverse:   #090B10
```

**Borders & Separators:**
```
--border-subtle:  rgba(255,255,255,0.06)
--border-active:  rgba(108, 99, 255, 0.5)
```

---

### 7.2 Typography

```
Font Stack:
  Display / Headings:    "Inter", system-ui, sans-serif
  Body / UI:             "Inter", system-ui, sans-serif
  Monospace / Data:      "JetBrains Mono", "Fira Code", monospace

Scale (rem, base 16px):
  --text-xs:   0.625rem  (10px)  — labels, badges
  --text-sm:   0.75rem   (12px)  — secondary UI, timestamps
  --text-base: 0.875rem  (14px)  — body
  --text-md:   1rem      (16px)  — card titles
  --text-lg:   1.25rem   (20px)  — section headings
  --text-xl:   1.5rem    (24px)  — page headings
  --text-2xl:  2rem      (32px)  — current chord (large display)
  --text-3xl:  3rem      (48px)  — empty state headings

Weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)
```

---

### 7.3 Spacing & Layout Grid

```
Base spacing unit: 4px
Scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80 / 96 / 128

Layout:
  Sidebar width:         240px (collapsible to 60px icon-only mode)
  Main content area:     flex-grow
  Player bar height:     80px (collapsed)
  Player expanded:       72vh max, slides up over content
  Card grid gap:         16px
  Card min-width:        220px
  Border radius base:    8px
  Border radius card:    12px
  Border radius pill:    9999px
```

---

### 7.4 Component Library

**Song Card:**
```
├── Thumbnail (16:9, rounded-t-lg, lazy loaded)
├── Gradient overlay at bottom of thumbnail
│   └── BPM + Key badges (glass pill style)
├── Card body (p-4)
│   ├── Title (text-md font-semibold, single line truncate)
│   ├── Artist (text-sm text-secondary)
│   ├── Stem dot row (6 colored dots with tooltips)
│   └── Duration (text-xs text-muted, right-aligned)
└── Hover state: elevates 4px with shadow glow, reveals quick-action icons
```

**Stem Card (in mixer):**
```
├── Color-coded left border (4px, stem color)
├── Stem icon + label (e.g., 🎸 Guitar)
├── Animated frequency bars (Lottie, only when stem is active and unmuted)
├── Solo button (S) + Mute button (M) — pill style toggle
├── Volume fader (vertical, styled)
├── Expand arrow → reveals EQ + Pan + Reverb
└── Muted state: entire card dims to 30% opacity
```

**Badge/Pill:**
```
Glass background + border-subtle
Variants: BPM, Key, Tempo%, Stem Label, Difficulty
```

**Progress/Loading Bar:**
- Indeterminate: animated shimmer left-to-right
- Determinate: fill with --accent-cyan, glow effect at leading edge

---

### 7.5 Lottie Animation Spec

All Lottie files should be sourced from LottieFiles.com or commissioned. Specify these by their function:

| ID | Trigger / Screen | Animation Description | Loop | Duration |
|---|---|---|---|---|
| `anim-processing` | Stem separation in progress | Waveform that "unzips" horizontally into 4–6 color bands, bands bounce independently | Loop | — |
| `anim-success` | Processing complete | Musical notes burst upward from a vinyl record, scatter and fade | Once | 2s |
| `anim-empty-library` | Library with 0 songs | Cartoon musician sitting, idly strumming, looking expectant | Loop | 8s |
| `anim-empty-setlist` | Empty setlist | A blank stage with a spotlight waiting | Loop | 6s |
| `anim-recording` | Record mode active | Microphone with 3 concentric ripple rings expanding outward, pulsing red | Loop | — |
| `anim-playback-stem` | Each stem card while playing | Short frequency bar bounce animation (per-stem, colored) | Loop | — |
| `anim-loading-url` | After URL is pasted, before thumbnail loads | Spinning vinyl record | Loop | — |
| `anim-logo-splash` | App cold start / loading screen | App name "SlicerSmthng" slices apart, each letter drifts back together | Once | 2.5s |
| `anim-error` | Error state | Broken vinyl record spinning down, cracking | Once | 1.8s |
| `anim-added-setlist` | Song added to setlist | Small checkmark draws itself, card floats with a spring motion | Once | 0.8s |
| `anim-hover-cta` | "Slice It" button idle hover | Subtle audio waveform pulse behind button text | Loop | — |
| `anim-chord-change` | Every chord change in timeline | Brief flash/bloom behind current chord label | Once per chord | 0.3s |

**Implementation:** Use `lottie-react` npm package. Each animation is loaded from a `.json` file in `src/animations/`. Lazy-loaded — don't block initial render.

---

### 7.6 Motion & Transitions

```css
/* Micro-interactions */
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1)   /* button clicks, card hover lift */
--ease-smooth:   cubic-bezier(0.4, 0, 0.2, 1)          /* panel slides, fades */
--ease-fast:     cubic-bezier(0.25, 0, 0.1, 1)          /* tooltips, quick toggles */

/* Durations */
--dur-instant:  80ms
--dur-fast:     150ms
--dur-base:     250ms
--dur-slow:     400ms
--dur-enter:    350ms   /* panel/modal enter */
--dur-exit:     200ms   /* panel/modal exit */
```

**Named animations:**
- `slideUpIn`: player expand — translate Y from 100% to 0, with `--ease-spring`
- `fadeIn`: modals, tooltips
- `cardLift`: song card hover — translateY(-4px) + box-shadow increase
- `stemPulse`: active stem playing — very subtle scale(1.005) oscillation
- `waveformScrub`: seek indicator — smooth translateX following cursor

---

## 8. Media Player Deep Spec

---

### 8.1 Collapsed Player Bar

**Dimensions:** Full width × 80px. Positioned fixed at bottom. `z-index: 100`. Background: `--bg-glass` (glassmorphism).

**Left Zone (240px):**
```
[Thumbnail 48x48 rounded-lg] [Title (truncated) / Artist / BPM pill / Key pill]
```

**Center Zone (flex-grow):**
```
[⏮ Prev] [⏪ -10s] [▶/⏸ Play/Pause — larger, 44px] [⏩ +10s] [⏭ Next]
    [Elapsed 00:00] ─────────────── [progress bar] ─────────────── [00:00 Total]
```
- Progress bar is clickable/draggable for seeking
- Progress bar fill color: animated gradient from `--accent-cyan` to `--primary`
- BPM and time display in `JetBrains Mono`

**Right Zone (200px):**
```
[🔁 Loop toggle] [Metronome toggle] [Expand ↑] [🔈 Master volume slider]
```

---

### 8.2 Expanded Player View

**Slide-up overlay:** `72vh` from bottom, full width. Spring animation. Dismiss by pressing Escape or clicking collapse.

**Layout (top to bottom):**
```
┌─────────────────────────────────────────────────────────────┐
│  HEADER: Thumbnail · Title · Artist · BPM · Key · ↓Collapse │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  WAVEFORM VISUALIZER                                         │
│  ← full-width, 120px height →                               │
│  [A marker]──────[loop region tinted]──────[B marker]       │
│  beat grid lines (faint vertical lines at each beat)        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  CHORD TIMELINE STRIP (40px height, scrolling)               │
│  ... Dm  |  G  |  [[ C ]]  |  Am  |  F  ...                 │
│           (current chord centered, large)                    │
├─────────────────────────────────────────────────────────────┤
│  STEM MIXER GRID (6 columns max, responsive)                 │
│  [Vocals][Drums][Bass][Guitar][Piano][Other]                 │
│  (each is a StemCard — see spec below)                       │
├──────────────────────────────┬──────────────────────────────┤
│  TRANSPORT + CONTROLS        │  NOTES SIDEBAR               │
│  Tempo: [50%|75%|90%|100%]   │  Song notes text area        │
│  Pitch: [−2 st] [Concert]    │  (free text, auto-saved)     │
│  [Metronome on/off + BPM]    │                              │
│  [Export Mix]  [Chord Chart] │  Tags / Setlists: ...        │
└──────────────────────────────┴──────────────────────────────┘
```

---

### 8.3 Waveform Visualizer

**Library:** `wavesurfer.js` v7 (renders the entire waveform from decoded audio data).

**Configuration:**
- Waveform drawn from the full mix audio (or the loudest stem if mix not available)
- Color: gradient from `--accent-cyan` (left) to `--primary` (right) for played region; `--bg-elevated` for unplayed
- Cursor: thin white vertical line, 2px wide
- Loop region: translucent fill in `--primary-glow`, with draggable A/B handle icons at edges
- Beat grid: vertical lines at each detected beat, color `--border-subtle`
- Measure numbers displayed every 4 beats below the waveform
- Waveform height: 120px
- Interaction: click to seek, drag A/B handles to set loop points

**Performance:** WaveSurfer renders to an HTML5 Canvas. Decoded once and cached. No re-render on playback — only cursor moves.

---

### 8.4 Chord Timeline Strip

**Dimensions:** Full width × 40px.

**Rendering:**
- Each chord occupies a proportional horizontal width based on its duration
- Chord label centered within its region
- Current chord: white, 20px bold, center-aligned in the strip, with a faint colored background block
- Adjacent chords: 14px, muted color, visible 2–3 chords ahead and behind
- When chord change occurs: brief `anim-chord-change` flash on the new chord label
- Click a chord region: seek to that timestamp

**Scroll behavior:**
- Strip is `overflow: hidden`; transforms `translateX` in JS in sync with `currentTime`
- Easing: `--ease-smooth`, no abrupt jumps

**When no chords detected:** Strip shows "Chord analysis unavailable" in muted text, with a "Re-analyze" button.

---

### 8.5 Stem Mixer Grid

**Layout:** CSS Grid, `repeat(auto-fit, minmax(160px, 1fr))`, gap 12px.

**Each StemCard (160px min-width, auto-height):**
```
┌──────────────────────────────┐
│ ▌ [stem-color left border]   │
│  🎸  Guitar                  │ ← icon + label
│  [Lottie frequency bars]     │ ← only when playing
│                              │
│  [ S ]  [ M ]                │ ← Solo | Mute buttons
│                              │
│  ─────── Volume ────────     │
│  ████████████░░░░  80%       │ ← horizontal fader
│                              │
│  [ ˅ EQ / Effects ]          │ ← expand for effects
└──────────────────────────────┘
```

**States:**
- **Active (playing):** Full opacity, border glowing with stem color, Lottie animation running
- **Muted:** Entire card at 35% opacity, `M` button filled red, Lottie stopped
- **Soloed:** Card has a bright outline in stem color; all other cards shift to muted appearance
- **Focused (keyboard nav):** `--border-active` ring around card

**Volume Fader:**
- Custom-styled `<input type="range">` with Tailwind/CSS overrides
- Track: 4px tall, rounded, filled with stem color proportionally
- Thumb: 16px circle, white, stem color glow on hover
- Value label updates live beside the fader

**EQ Expand:**
- Accordion reveal (200ms ease)
- Three rotary knobs: Bass / Mid / Treble (custom SVG knob component)
- Pan knob (L–R)
- Reverb dry/wet slider

---

## 9. Technical Architecture

---

### 9.1 System Overview

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (React 18)                │
│  React Router · Zustand (state) · TailwindCSS        │
│  WaveSurfer.js · Tone.js · Lottie-React              │
│  Web Audio API (AudioContext, GainNode, etc.)         │
└───────────────────┬─────────────────────────────────┘
                    │ HTTP + WebSocket
┌───────────────────▼─────────────────────────────────┐
│                  BACKEND (Python / Flask)             │
│  Flask REST API · Flask-SocketIO (progress events)   │
│  yt-dlp (YouTube download)                           │
│  Demucs (stem separation)                            │
│  librosa / madmom (BPM, Key, Chord analysis)         │
│  FFmpeg (audio conversion)                           │
└───────────────────┬─────────────────────────────────┘
                    │ File system
┌───────────────────▼─────────────────────────────────┐
│              LOCAL STORAGE                           │
│  ~/Music/SlicerSmthng/{song_id}/                     │
│  stems/*.mp3, thumbnail.jpg, song_meta.json          │
│  setlists.json (app state)                           │
│  mix_snapshots.json (per-song configurations)         │
└─────────────────────────────────────────────────────┘
```

---

### 9.2 Backend API

All endpoints under `/api/v1/`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/import` | Submit YouTube URL. Returns `job_id`. |
| `GET` | `/jobs/{job_id}` | Job status (pending/running/done/error). |
| `GET` | `/songs` | List all songs in library. |
| `GET` | `/songs/{id}` | Song metadata + chord data. |
| `DELETE` | `/songs/{id}` | Delete song and all stems. |
| `GET` | `/songs/{id}/stems/{stem}` | Stream a stem audio file. |
| `GET` | `/songs/{id}/thumbnail` | Song thumbnail image. |
| `POST` | `/songs/{id}/reprocess` | Re-run separation + analysis. |
| `GET` | `/setlists` | List all setlists. |
| `POST` | `/setlists` | Create new setlist. |
| `PUT` | `/setlists/{id}` | Update setlist (name, order, songs). |
| `DELETE` | `/setlists/{id}` | Delete setlist. |
| `POST` | `/songs/{id}/snapshots` | Save mix snapshot for a song. |
| `GET` | `/songs/{id}/snapshots` | Get saved mix snapshots. |

**WebSocket Events (Flask-SocketIO):**
```
job:progress  { job_id, stage, percent, message }
job:complete  { job_id, song }
job:error     { job_id, error }
```

---

### 9.3 Frontend State Management

**Zustand stores:**

```typescript
// playerStore — the audio engine state
{
  currentSong: Song | null
  isPlaying: boolean
  currentTime: number
  duration: number
  masterVolume: number
  tempoPercent: number    // 50–120
  pitchSemitones: number  // -6 to +6
  loopA: number | null
  loopB: number | null
  loopActive: boolean
  stems: Record<StemName, StemState>  // volume, muted, solo
  activeSetlist: Setlist | null
  queueIndex: number
}

// libraryStore
{
  songs: Song[]
  isLoading: boolean
  searchQuery: string
  filters: LibraryFilters
}

// setlistStore
{
  setlists: Setlist[]
  activeSetlistId: string | null
}

// jobStore — processing jobs
{
  jobs: Record<string, Job>  // job_id → Job
}
```

---

### 9.4 Audio Engine

**Primary approach: Web Audio API (client-side)**

```
AudioContext
  ├── MasterGain (masterVolume)
  │   └── → AudioDestination
  │
  ├── StemBufferSource[vocals]  → StemGain[vocals]  → MasterGain
  ├── StemBufferSource[drums]   → StemGain[drums]   → MasterGain
  ├── StemBufferSource[bass]    → StemGain[bass]    → MasterGain
  ├── StemBufferSource[guitar]  → StemGain[guitar]  → MasterGain
  ├── StemBufferSource[piano]   → StemGain[piano]   → MasterGain
  └── StemBufferSource[other]   → StemGain[other]   → MasterGain
```

For per-stem EQ:
```
StemBufferSource → BiquadFilter[bass] → BiquadFilter[mid] → BiquadFilter[treble]
                → StemPanNode → StemGain → ConvolverNode[reverb] → MasterGain
```

**Slowdown:** Pre-generated server-side at 50%, 75%, 90% speed using `librosa.effects.time_stretch`. Stored as `vocals_75.mp3`, etc. Client switches audio sources when tempo preset is selected. Preserves 100% sync across all stems.

**Playback sync:** All `AudioBufferSourceNode`s started with identical `startTime = AudioContext.currentTime + 0.1` to ensure atomic start. Pause/resume uses `AudioContext.suspend()` / `AudioContext.resume()` for perfect sync.

**Recording:** `navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder` → Blob → upload to backend → saved as `recording_N.mp3`.

---

### 9.5 Data Models

```typescript
interface Song {
  id: string
  title: string
  artist: string
  duration: number      // seconds
  bpm: number
  key: string           // e.g., "F# minor"
  stems: StemName[]
  chords: ChordEvent[]
  thumbnail_url: string
  youtube_url: string
  model_used: string
  added_at: string      // ISO 8601
  notes: string
}

interface ChordEvent {
  time: number          // seconds
  chord: string         // e.g., "Am7"
}

interface StemState {
  volume: number        // 0.0 – 1.0
  muted: boolean
  solo: boolean
  eq: { bass: number; mid: number; treble: number }  // dB
  pan: number           // -1.0 to 1.0
  reverb: number        // 0.0 to 1.0 dry/wet
}

interface MixSnapshot {
  song_id: string
  stems: Record<StemName, StemState>
  tempo_percent: number
  loop_a: number | null
  loop_b: number | null
  loop_active: boolean
  pitch_semitones: number
}

interface Setlist {
  id: string
  name: string
  color: string         // one of 8 palette tokens
  songs: SetlistEntry[]
  created_at: string
  last_played_at: string | null
}

interface SetlistEntry {
  song_id: string
  snapshot: MixSnapshot | null  // null = use default
}
```

---

## 10. Screen-by-Screen UX Flows

---

### Flow 1: First Run — Empty State to First Song

```
App opens
  └─ Splash screen: anim-logo-splash plays (2.5s)
  └─ Dashboard loads: anim-empty-library in center
     "Paste a YouTube link above to get started"
  └─ User pastes URL into URL bar
  └─ anim-loading-url plays while thumbnail fetches
  └─ Thumbnail + title + duration shown inline in URL bar
  └─ User selects model (default: htdemucs_ft) → clicks "Slice It"
  └─ Processing modal opens: anim-processing loops
     Stage labels update: Downloading → Extracting → AI Separating → Analyzing
  └─ Song ready: anim-success plays → modal closes
  └─ Song card appears in library grid (slide-in from top)
  └─ Player auto-loads the song (collapsed bar appears)
  └─ User clicks expand → player expanded view opens with stems, waveform, chords
```

---

### Flow 2: Building a Setlist

```
User opens Setlists tab
  └─ anim-empty-setlist if no setlists exist
  └─ Clicks "New Setlist"
  └─ Name field auto-focused, user types "Friday Gig"
  └─ Selects color tag (blue)
  └─ Clicks "Add Songs" → library modal opens
  └─ Searches / filters / selects 8 songs (multi-select with checkboxes)
  └─ Clicks "Add Selected" → songs appear in setlist with drag handles
  └─ User drags to reorder
  └─ Clicks each song → player opens for that song → user configures stems → changes auto-saved
  └─ Clicks "Play Setlist" from setlist header
  └─ Player begins playing song 1 in setlist mode
  └─ Queue sidebar visible in expanded player
```

---

### Flow 3: Practicing a Difficult Section

```
Song is loaded and playing
  └─ User expands player
  └─ Listens, identifies the hard 8-bar bridge
  └─ At start of bridge: presses [ → A marker placed
  └─ At end of bridge: presses ] → B marker placed
  └─ Loop region highlighted on waveform
  └─ Presses L → loop activates
  └─ Clicks tempo button "75%" → stems at 75% speed (pitch unchanged)
  └─ Clicks "M" on vocals, drums → only guitar and bass audible
  └─ User practices along with loop
  └─ Chord timeline scrolls in sync overhead, showing chord names
  └─ After mastering section, clicks L to disable loop, "100%" for normal speed
  └─ Mix snapshot auto-saved on navigate away
```

---

### Flow 4: Recording a Take

```
Song is playing with stems configured
  └─ User taps microphone icon in player toolbar
  └─ Permission prompt (browser getUserMedia)
  └─ Input level meter appears, user checks gain
  └─ User arms recording → player stops
  └─ User presses play → 1-bar click countdown (at detected BPM)
  └─ Recording starts, anim-recording loops (pulsing red mic)
  └─ Player reaches end of loop / song → recording stops
  └─ Recording saved as "My Take 1" — appears as new stem card (amber)
  └─ User clicks play → hears themselves + backing stems
  └─ User clicks "Export Mix" → backend renders stems + recording to MP3
  └─ OS file save dialog opens
```

---

## 11. Accessibility

- All interactive elements reachable via keyboard (Tab order follows visual layout)
- `aria-label` on all icon-only buttons
- Focus rings visible (2px `--primary` outline, not outline:none without replacement)
- Player controls announce state to screen readers via `aria-live` regions (e.g., "Playing — Paused")
- Color is never the sole indicator of state (muted stems also show icon change)
- Minimum contrast ratio 4.5:1 for all body text on card backgrounds
- Reduced motion media query: all Lottie animations and transitions respect `prefers-reduced-motion: reduce` by showing static equivalents

---

## 12. Roadmap

### v1.0 — Core Redesign (Target: 6–8 weeks)
**Goal:** Replace the existing Flask HTML/JS app with a React frontend. Full feature parity + the four v1 must-haves.

| Week | Work |
|---|---|
| 1 | Project scaffold (Vite + React + Tailwind), design tokens, component library foundation |
| 2 | Library screen + Song Card components, backend API cleanup (Flask REST) |
| 3 | Player bar (collapsed) + Web Audio API engine rewrite in React |
| 4 | Expanded player — waveform (WaveSurfer), stem mixer grid, A/B loop markers |
| 5 | Chord detection pipeline (madmom/autochord) + Chord Timeline strip component |
| 6 | Setlists — create, edit, playback mode, mix snapshots |
| 7 | Record Over Stems feature + Lottie animations integration |
| 8 | Polish pass — transitions, keyboard shortcuts, accessibility, error handling |

### v1.1 — Audio Effects (2 weeks)
- Per-stem EQ (Web Audio API BiquadFilter)
- Per-stem Pan
- Per-stem Reverb (ConvolverNode)
- Export custom mix to MP3 (server-side FFmpeg mix-down)

### v1.2 — Practice Intelligence (3 weeks)
- Instrument difficulty rating (BPM × chord complexity × stem density)
- Practice progress tracker (Learning / In Progress / Performance Ready)
- Chord chart PDF export
- Notes & annotations per song

### v2.0 — Social & Cloud Sync (TBD)
- Optional cloud sync of library metadata + setlists (Supabase backend)
- Share setlists with other SlicerSmthng users via link
- Community chord corrections (users can submit corrected chords for a YouTube URL)

### v3.0 — Advanced AI (TBD)
- Real-time stem separation (for live audio input — extremely demanding, GPU required)
- Automatic tablature / lead sheet generation from chord + pitch data
- AI-suggested practice exercises based on detected chord complexity

---

## 13. Out of Scope for v1

- Windows / Linux support (v1 targets macOS, particularly Apple Silicon)
- Mobile app (potential v2 consideration with Capacitor or React Native)
- Online/SaaS hosting (v1 is fully local, no server costs, no accounts)
- Support for sources other than YouTube (SoundCloud, Spotify, local files) — v1.2
- MIDI export from chord detection
- Real-time stem separation
- Multiple simultaneous YouTube imports (queue is supported, parallel is not)
- Plugin system / VST integration

---

*SlicerSmthng PRD v2.0 — Prepared February 2026*
*For questions about this document, consult the project owner.*
