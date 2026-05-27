/**
 * Multi-stem Web Audio engine. Module-level singleton — there's one
 * AudioContext per page, all stems play in lockstep through it.
 *
 *   AudioContext
 *     └── masterGain (master volume)
 *         └── destination
 *             ├── source[vocals] → gain[vocals]  ─┐
 *             ├── source[drums]  → gain[drums]   ─┤
 *             ├── source[bass]   → gain[bass]    ─┼─→ masterGain
 *             ├── source[guitar] → gain[guitar]  ─┤
 *             ├── source[piano]  → gain[piano]   ─┤
 *             └── source[other]  → gain[other]   ─┘
 *
 * AudioBufferSourceNodes are single-use, so play/pause/seek/tempo-change
 * all stop the current sources and create new ones — scheduled to start at
 * a common future timestamp so they stay sample-aligned.
 */
import { usePlayerStore } from '../stores/playerStore';

interface StemNode {
  buffer: AudioBuffer;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stems = new Map<string, StemNode>();

  // Position tracking. `playbackStartedAt` is the AudioContext time at which
  // (notional) audio-time 0 would have started, given the current tempo.
  // currentPosition = (ctx.currentTime - playbackStartedAt) * tempo
  private playbackStartedAt = 0;
  private playbackOffset = 0;
  private playing = false;
  private tempo = 1;
  private loadedSongId: string | null = null;
  private rafId: number | null = null;

  // ---- Metronome ----
  private metronomeGain: GainNode | null = null;
  private metronomeNextClickTime = 0;     // ctx.currentTime of the next scheduled click
  private metronomeBeatIndex = 0;         // global beat counter; index % 4 === 0 = downbeat
  private metronomeBpm = 120;             // captured at play-start so changes mid-stop don't desync
  private metronomeVolume = 0.6;
  // Pre-synthesized click waveforms — bulletproof vs the older
  // gain-envelope approach (which silently dropped clicks on some browsers).
  private clickBufferAccent: AudioBuffer | null = null;
  private clickBufferRegular: AudioBuffer | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = usePlayerStore.getState().masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  isReady(songId: string) {
    return this.loadedSongId === songId;
  }

  async loadSong(songId: string, stemNames: string[]) {
    // Tear down anything currently loaded.
    this.stopSources();
    this.disposeStems();
    this.playbackOffset = 0;
    this.playing = false;
    usePlayerStore.getState().setCurrentTime(0);

    if (!stemNames.length) {
      this.loadedSongId = null;
      usePlayerStore.getState().setDuration(0);
      return;
    }

    const ctx = this.ensureCtx();

    // Fetch + decode all stems in parallel.
    const decoded = await Promise.all(
      stemNames.map(async (name) => {
        const url = `/api/v1/songs/${songId}/stems/${name}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`stem ${name} HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        // decodeAudioData can take an ArrayBuffer or a callback form depending
        // on browser; the promise form is widely supported in modern browsers.
        const audio = await ctx.decodeAudioData(buf);
        return { name, audio };
      }),
    );

    for (const { name, audio } of decoded) {
      const gain = ctx.createGain();
      gain.connect(this.masterGain!);
      this.stems.set(name, { buffer: audio, gain, source: null });
    }

    // Duration = longest stem (they're usually identical for separated tracks).
    let maxDur = 0;
    decoded.forEach(({ audio }) => { if (audio.duration > maxDur) maxDur = audio.duration; });
    usePlayerStore.getState().setDuration(maxDur);

    this.loadedSongId = songId;
    this.applyStemGains();
  }

  play(opts?: { countInBeats?: number }) {
    const ctx = this.ensureCtx();
    if (this.playing) return;
    // AudioContext starts "suspended" until a user gesture — this resume is
    // the gesture-bound call that lets audio actually play.
    void ctx.resume();

    const state = usePlayerStore.getState();
    this.metronomeBpm = Math.max(40, Math.min(240, state.currentSong?.bpm || 120));
    const secondsPerBeat = 60 / this.metronomeBpm;
    const countInBeats = Math.max(0, opts?.countInBeats || 0);
    const countInDuration = countInBeats * secondsPerBeat;

    const stemStartAt = ctx.currentTime + 0.05 + countInDuration;
    const offset = Math.max(0, Math.min(this.playbackOffset, this.maxDuration()));

    // Count-in clicks fire BEFORE stems start. Plays regardless of whether
    // metronomeEnabled is on — count-in is a user-requested intent.
    if (countInBeats > 0) {
      this.ensureMetronomeGain();
      for (let i = 0; i < countInBeats; i++) {
        const clickTime = ctx.currentTime + 0.05 + i * secondsPerBeat;
        this.scheduleClick(clickTime, i === 0);
      }
    }

    this.stems.forEach((node) => {
      const src = ctx.createBufferSource();
      src.buffer = node.buffer;
      src.playbackRate.value = this.tempo;
      src.connect(node.gain);
      try {
        src.start(stemStartAt, offset);
      } catch {
        // start() throws if buffer is null or duration is invalid — skip silently
      }
      node.source = src;
    });

    this.playbackStartedAt = stemStartAt - offset / this.tempo;
    this.playing = true;

    // Metronome: snap next click to the next whole beat in song time, then
    // convert that song time back to audio-clock time.
    this.metronomeBeatIndex = Math.ceil(offset / secondsPerBeat);
    const firstBeatInSongTime = this.metronomeBeatIndex * secondsPerBeat;
    this.metronomeNextClickTime = stemStartAt + (firstBeatInSongTime - offset) / this.tempo;

    this.startRaf();
  }

  private ensureMetronomeGain() {
    if (!this.ctx || this.metronomeGain) return;
    this.metronomeGain = this.ctx.createGain();
    this.metronomeGain.gain.value = this.metronomeVolume;
    this.metronomeGain.connect(this.ctx.destination);
  }

  private synthesizeClickBuffers() {
    if (!this.ctx || this.clickBufferAccent) return;
    const sampleRate = this.ctx.sampleRate;
    const synth = (freq: number, peak: number): AudioBuffer => {
      const duration = 0.05;
      const samples = Math.floor(sampleRate * duration);
      const buf = this.ctx!.createBuffer(1, samples, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-35 * t);
        data[i] = peak * env * Math.sin(2 * Math.PI * freq * t);
      }
      return buf;
    };
    // Downbeat = brighter + louder; regular = lower + softer
    this.clickBufferAccent = synth(1800, 0.95);
    this.clickBufferRegular = synth(1100, 0.55);
  }

  setMetronomeVolume(v: number) {
    this.metronomeVolume = Math.max(0, Math.min(1, v));
    if (this.metronomeGain) this.metronomeGain.gain.value = this.metronomeVolume;
  }

  pause() {
    if (!this.playing || !this.ctx) return;
    this.playbackOffset = this.currentPosition();
    this.stopSources();
    this.playing = false;
    usePlayerStore.getState().setCurrentTime(this.playbackOffset);
  }

  seek(t: number) {
    const target = Math.max(0, Math.min(t, this.maxDuration()));
    this.playbackOffset = target;
    if (this.playing) {
      // Restart all sources at the new offset. CRUCIAL: clear the playing
      // flag first, otherwise play() short-circuits via its early-return and
      // we end up with stopped sources + no new ones (silent dead audio).
      this.stopSources();
      this.playing = false;
      this.play();
    } else {
      usePlayerStore.getState().setCurrentTime(target);
    }
  }

  setTempo(percent: number) {
    const next = Math.max(10, Math.min(200, percent)) / 100;
    if (Math.abs(next - this.tempo) < 1e-6) return;
    if (this.playing) {
      // Capture position at the OLD rate first, then restart at the new one.
      // Same early-return trap as seek() — clear the flag before play().
      this.playbackOffset = this.currentPosition();
      this.stopSources();
      this.playing = false;
      this.tempo = next;
      this.play();
    } else {
      this.tempo = next;
    }
  }

  setMasterVolume(v: number) {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * Schedule metronome clicks for the next ~250ms of playback. Idempotent —
   * called every animation frame; only new clicks beyond the current schedule
   * horizon get added.
   */
  private scheduleMetronomeClicks() {
    const state = usePlayerStore.getState();
    if (!state.metronomeEnabled || !this.playing || !this.ctx) return;
    this.ensureMetronomeGain();

    // Resync if the next click time is stale (toggled on mid-song).
    if (this.metronomeNextClickTime < this.ctx.currentTime - 0.05) {
      const songPos = this.currentPosition();
      const songBpm = Math.max(40, Math.min(240, state.currentSong?.bpm || 120));
      this.metronomeBpm = songBpm;
      const secondsPerBeatInSong = 60 / songBpm;
      this.metronomeBeatIndex = Math.ceil(songPos / secondsPerBeatInSong);
      const beatPosInSong = this.metronomeBeatIndex * secondsPerBeatInSong;
      this.metronomeNextClickTime = this.ctx.currentTime + (beatPosInSong - songPos) / this.tempo;
    }

    const secondsPerBeatRealtime = 60 / this.metronomeBpm / this.tempo;
    const horizon = this.ctx.currentTime + 0.25;
    while (this.metronomeNextClickTime < horizon) {
      this.scheduleClick(this.metronomeNextClickTime, this.metronomeBeatIndex % 4 === 0);
      this.metronomeNextClickTime += secondsPerBeatRealtime;
      this.metronomeBeatIndex += 1;
    }
  }

  /**
   * Fire a single metronome click at the given audio-clock time.
   * Uses a pre-synthesized AudioBuffer instead of building a gain envelope —
   * way more reliable across browsers + handles past-time scheduling sanely.
   */
  private scheduleClick(when: number, accent: boolean) {
    if (!this.ctx) return;
    this.ensureMetronomeGain();
    this.synthesizeClickBuffers();
    const buffer = accent ? this.clickBufferAccent : this.clickBufferRegular;
    if (!buffer || !this.metronomeGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.metronomeGain);
    try {
      src.start(Math.max(when, this.ctx.currentTime));
    } catch {
      // start() can throw if `when` is invalid — skip silently
    }
  }

  /**
   * Recompute per-stem effective gain from the store. Honors per-stem volume,
   * mute, and solo (if any stem is soloed, only soloed stems play).
   */
  applyStemGains() {
    const state = usePlayerStore.getState();
    const anySolo = Object.values(state.stems).some((s) => s.solo);
    this.stems.forEach((node, name) => {
      const st = state.stems[name];
      if (!st) { node.gain.gain.value = 0; return; }
      let g = st.volume;
      if (st.muted) g = 0;
      else if (anySolo && !st.solo) g = 0;
      node.gain.gain.value = g;
    });
  }

  private stopSources() {
    this.stems.forEach((node) => {
      if (node.source) {
        try { node.source.stop(); } catch { /* already stopped */ }
        try { node.source.disconnect(); } catch { /* already gone */ }
        node.source = null;
      }
    });
  }

  private disposeStems() {
    this.stems.forEach((node) => {
      try { node.gain.disconnect(); } catch { /* already gone */ }
    });
    this.stems.clear();
  }

  private currentPosition(): number {
    if (!this.playing || !this.ctx) return this.playbackOffset;
    const elapsed = this.ctx.currentTime - this.playbackStartedAt;
    return Math.max(0, elapsed * this.tempo);
  }

  private maxDuration(): number {
    let max = 0;
    this.stems.forEach((n) => { if (n.buffer.duration > max) max = n.buffer.duration; });
    return max;
  }

  private startRaf() {
    if (this.rafId != null) return;
    const tick = () => {
      if (!this.playing) { this.rafId = null; return; }
      this.scheduleMetronomeClicks();
      const pos = this.currentPosition();
      const state = usePlayerStore.getState();

      // A/B loop check
      if (state.loopActive && state.loopA != null && state.loopB != null
          && pos >= state.loopB && state.loopB > state.loopA) {
        this.seek(state.loopA);
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      // End-of-song
      if (pos >= this.maxDuration() - 0.01) {
        this.pause();
        this.seek(0);
        state.setPlaying(false);
        this.rafId = null;
        return;
      }

      state.setCurrentTime(pos);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}

export const audioEngine = new AudioEngine();
