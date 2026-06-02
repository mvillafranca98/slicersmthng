/**
 * Multi-stem audio engine with PITCH-NEUTRAL time stretch + independent pitch shift.
 *
 * Backbone: Tone.js GrainPlayer (granular synthesis). Unlike a plain
 * AudioBufferSourceNode (where playbackRate shifts BOTH speed and pitch),
 * GrainPlayer's playbackRate is time-stretch only — pitch stays constant.
 * `detune` is the pitch knob (in cents; 100 cents = 1 semitone).
 *
 *   Tone.GrainPlayer[vocals] → Tone.Gain[vocals]  ─┐
 *   Tone.GrainPlayer[drums]  → Tone.Gain[drums]   ─┤
 *   Tone.GrainPlayer[bass]   → Tone.Gain[bass]    ─┼─→ Tone.Gain[master] → destination
 *   Tone.GrainPlayer[guitar] → Tone.Gain[guitar]  ─┤
 *   Tone.GrainPlayer[piano]  → Tone.Gain[piano]   ─┤
 *   Tone.GrainPlayer[other]  → Tone.Gain[other]   ─┘
 *
 * Metronome uses native Web Audio via Tone.getContext().rawContext — clicks
 * are pre-synthesized into AudioBuffers and scheduled with a buffer source.
 */
import * as Tone from 'tone';
import { usePlayerStore } from '../stores/playerStore';

interface StemNode {
  buffer: AudioBuffer;        // raw AudioBuffer — kept for waveform visualization
  player: Tone.GrainPlayer;
  gain: Tone.Gain;
}

class AudioEngine {
  private masterGain: Tone.Gain | null = null;
  private stems = new Map<string, StemNode>();

  // Position tracking. With GrainPlayer's pitch-neutral stretch, audio
  // advances through the song at `tempo` × wall-clock-time.
  //   currentPosition = (ctx.currentTime - playbackStartedAt) * tempo
  private playbackStartedAt = 0;
  private playbackOffset = 0;
  private playing = false;
  private tempo = 1;
  private pitchCents = 0;
  private loadedSongId: string | null = null;
  private rafId: number | null = null;

  // ---- Metronome (native Web Audio for low-latency clicks) ----
  private metronomeGain: GainNode | null = null;
  private metronomeNextClickTime = 0;
  private metronomeBeatIndex = 0;
  private metronomeBpm = 120;
  private metronomeBeatOffset = 0;
  private metronomeVolume = 0.6;
  private clickBufferAccent: AudioBuffer | null = null;
  private clickBufferRegular: AudioBuffer | null = null;
  // Outstanding scheduled click sources, so we can yank any future-but-not-
  // yet-played clicks when the anchor changes via Mark 1. Without this,
  // the user has to wait out the WebAudio look-ahead window (~250ms) of
  // pre-scheduled clicks before they hear the new phase.
  private pendingClickSources: { src: AudioBufferSourceNode; when: number }[] = [];

  /** Optional callback invoked at end-of-song when playMode is continue or shuffle.
   *  Set by useAudioEngine hook which knows about the library + setlists. */
  onRequestNext: ((mode: 'continue' | 'shuffle') => void) | null = null;

  private get ctx(): AudioContext {
    return Tone.getContext().rawContext as AudioContext;
  }

  private async ensureContext(): Promise<void> {
    // Tone's context starts suspended; resume on first user gesture.
    if (Tone.getContext().state !== 'running') {
      try { await Tone.start(); } catch { /* ignore */ }
    }
    if (!this.masterGain) {
      this.masterGain = new Tone.Gain(usePlayerStore.getState().masterVolume).toDestination();
    }
  }

  isReady(songId: string): boolean {
    return this.loadedSongId === songId;
  }

  /** Live song-time position (sec). Computed from the audio clock, not
   *  from React state, so it's drift-free even between rAF frames. Use
   *  this for time-critical UI (e.g. "Mark 1" needs the actual moment
   *  of the user's tap, not the most recent rAF snapshot). */
  getPosition(): number {
    return this.currentPosition();
  }

  /** Expose raw AudioBuffers so the waveform component can render peaks. */
  getStemBuffers(): Map<string, AudioBuffer> {
    const out = new Map<string, AudioBuffer>();
    this.stems.forEach((node, name) => { out.set(name, node.buffer); });
    return out;
  }

  async loadSong(songId: string, stemNames: string[]): Promise<void> {
    this.stopPlayers();
    this.disposeStems();
    this.playbackOffset = 0;
    this.playing = false;
    usePlayerStore.getState().setCurrentTime(0);

    if (!stemNames.length) {
      this.loadedSongId = null;
      usePlayerStore.getState().setDuration(0);
      return;
    }

    await this.ensureContext();
    const ctx = this.ctx;

    const decoded = await Promise.all(
      stemNames.map(async (name) => {
        const url = `/api/v1/songs/${songId}/stems/${name}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`stem ${name} HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const audio = await ctx.decodeAudioData(buf);
        return { name, audio };
      }),
    );

    for (const { name, audio } of decoded) {
      const tBuf = new Tone.ToneAudioBuffer(audio);
      const player = new Tone.GrainPlayer({ url: tBuf });
      // Small grains = minimal artifact at normal playback; modest overlap
      // smooths transitions when stretching. Tuned for music vs speech.
      player.grainSize = 0.08;
      player.overlap = 0.04;
      player.detune = this.pitchCents;
      player.playbackRate = this.tempo;
      const gain = new Tone.Gain(1);
      player.connect(gain);
      gain.connect(this.masterGain!);
      this.stems.set(name, { buffer: audio, player, gain });
    }

    let maxDur = 0;
    decoded.forEach(({ audio }) => { if (audio.duration > maxDur) maxDur = audio.duration; });
    usePlayerStore.getState().setDuration(maxDur);
    this.loadedSongId = songId;
    this.applyStemGains();
  }

  play(opts?: { countInBeats?: number }): void {
    if (this.playing) return;
    void this.ensureContext();
    const ctx = this.ctx;
    if (!this.masterGain) return;  // bail if context not ready yet

    const state = usePlayerStore.getState();
    this.metronomeBpm = Math.max(40, Math.min(240, state.currentSong?.bpm || 120));
    const secondsPerBeat = 60 / this.metronomeBpm;
    const countInBeats = Math.max(0, opts?.countInBeats || 0);
    const countInDuration = countInBeats * secondsPerBeat;

    const stemStartAt = ctx.currentTime + 0.05 + countInDuration;
    const offset = Math.max(0, Math.min(this.playbackOffset, this.maxDuration()));

    // Count-in clicks (always plays, even if metronomeEnabled is off)
    if (countInBeats > 0) {
      this.ensureMetronomeGain();
      for (let i = 0; i < countInBeats; i++) {
        const clickTime = ctx.currentTime + 0.05 + i * secondsPerBeat;
        this.scheduleClick(clickTime, i === 0);
      }
    }

    // Apply current tempo + pitch to every player (live, no restart needed
    // for subsequent changes — but on initial start we make sure).
    this.applyTempoAndPitch();

    // Start every GrainPlayer at the same future timestamp + offset.
    this.stems.forEach((node) => {
      try {
        // Tone GrainPlayer.start(time, offset)
        node.player.start(stemStartAt, offset);
      } catch (e) {
        console.error('[audioEngine] player.start failed', e);
      }
    });

    this.playbackStartedAt = stemStartAt - offset / this.tempo;
    this.playing = true;

    // Metronome: snap to next whole beat in song time, then convert to audio time
    this.metronomeBeatIndex = Math.ceil(offset / secondsPerBeat);
    const firstBeatInSongTime = this.metronomeBeatIndex * secondsPerBeat;
    this.metronomeNextClickTime = stemStartAt + (firstBeatInSongTime - offset) / this.tempo;

    this.startRaf();
  }

  pause(): void {
    if (!this.playing) return;
    this.playbackOffset = this.currentPosition();
    this.stopPlayers();
    this.playing = false;
    usePlayerStore.getState().setCurrentTime(this.playbackOffset);
  }

  seek(t: number): void {
    const target = Math.max(0, Math.min(t, this.maxDuration()));
    this.playbackOffset = target;
    if (this.playing) {
      // GrainPlayer requires stop + start to jump to a new offset.
      this.stopPlayers();
      this.playing = false;
      this.play();
    } else {
      usePlayerStore.getState().setCurrentTime(target);
    }
  }

  setTempo(percent: number): void {
    const next = Math.max(10, Math.min(200, percent)) / 100;
    if (Math.abs(next - this.tempo) < 1e-6) return;
    // GrainPlayer can change playbackRate LIVE without a restart — but our
    // position math depends on tempo, so we re-anchor playbackStartedAt.
    if (this.playing) {
      const posAtOldRate = this.currentPosition();
      this.playbackOffset = posAtOldRate;
      this.tempo = next;
      // From this instant forward, position = (ctx.currentTime - newStart) * newTempo
      this.playbackStartedAt = this.ctx.currentTime - posAtOldRate / this.tempo;
    } else {
      this.tempo = next;
    }
    this.applyTempoAndPitch();
  }

  setPitchSemitones(semitones: number): void {
    const next = Math.max(-12, Math.min(12, semitones)) * 100;
    if (Math.abs(next - this.pitchCents) < 1e-6) return;
    this.pitchCents = next;
    // Pitch is independent of speed — no position re-anchoring needed.
    this.applyTempoAndPitch();
  }

  setMasterVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Push current tempo + pitch into every active GrainPlayer. */
  private applyTempoAndPitch(): void {
    this.stems.forEach((node) => {
      try {
        node.player.playbackRate = this.tempo;
        node.player.detune = this.pitchCents;
      } catch {
        // node.player might be in an odd state during teardown
      }
    });
  }

  /**
   * Recompute per-stem effective gain from the store. Honors per-stem volume,
   * mute, and solo (if any stem is soloed, only soloed stems play).
   */
  applyStemGains(): void {
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

  private stopPlayers(): void {
    this.stems.forEach((node) => {
      try { node.player.stop(); } catch { /* not started */ }
    });
  }

  private disposeStems(): void {
    this.stems.forEach((node) => {
      try { node.player.dispose(); } catch { /* already gone */ }
      try { node.gain.dispose(); } catch { /* already gone */ }
    });
    this.stems.clear();
  }

  private currentPosition(): number {
    if (!this.playing) return this.playbackOffset;
    const elapsed = this.ctx.currentTime - this.playbackStartedAt;
    return Math.max(0, elapsed * this.tempo);
  }

  private maxDuration(): number {
    let max = 0;
    this.stems.forEach((n) => { if (n.buffer.duration > max) max = n.buffer.duration; });
    return max;
  }

  // ---- Metronome (unchanged from previous build, pre-synthesized clicks) ----

  private ensureMetronomeGain(): void {
    if (!this.ctx || this.metronomeGain) return;
    this.metronomeGain = this.ctx.createGain();
    this.metronomeGain.gain.value = this.metronomeVolume;
    this.metronomeGain.connect(this.ctx.destination);
  }

  private synthesizeClickBuffers(): void {
    if (!this.ctx || this.clickBufferAccent) return;
    const sampleRate = this.ctx.sampleRate;
    const synth = (freq: number, peak: number): AudioBuffer => {
      const duration = 0.05;
      const samples = Math.floor(sampleRate * duration);
      const buf = this.ctx.createBuffer(1, samples, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-35 * t);
        data[i] = peak * env * Math.sin(2 * Math.PI * freq * t);
      }
      return buf;
    };
    this.clickBufferAccent = synth(1800, 0.95);
    this.clickBufferRegular = synth(1100, 0.55);
  }

  setMetronomeVolume(v: number): void {
    this.metronomeVolume = Math.max(0, Math.min(1, v));
    if (this.metronomeGain) this.metronomeGain.gain.value = this.metronomeVolume;
  }

  private scheduleMetronomeClicks(): void {
    const state = usePlayerStore.getState();
    if (!state.metronomeEnabled || !this.playing || !this.ctx) return;
    this.ensureMetronomeGain();

    // Effective tempo: user override wins over the auto-detected BPM.
    const songBpm = Math.max(
      30,
      Math.min(300, state.bpmOverride ?? state.currentSong?.bpm ?? 120),
    );
    // beatOffsetSec is the ABSOLUTE song-time of beat 0. The click grid is
    // { anchor + N*period | N integer } with the accent on N % 4 === 0,
    // so the click at the anchor itself is always the bar-1-beat-1 accent.
    // This is what "Mark 1" relies on — it sets the anchor to currentTime
    // and the very next click thereafter is the accent at that moment.
    const beatAnchor = state.beatOffsetSec || 0;

    // Re-snap when the song moved past the next click (normal advance),
    // when BPM changed, or when the anchor moved (Mark 1 / Reset).
    const bpmChanged = Math.abs(this.metronomeBpm - songBpm) > 0.1;
    const anchorChanged = Math.abs(this.metronomeBeatOffset - beatAnchor) > 0.01;
    const overdue = this.metronomeNextClickTime < this.ctx.currentTime - 0.05;
    if (overdue || bpmChanged || anchorChanged) {
      // When the user moved the anchor or BPM mid-playback, yank any
      // already-queued clicks that are still in the WebAudio look-ahead
      // window so they don't fire at the OLD phase before the new
      // schedule takes effect. Without this, Mark 1 had a 50-250ms lag.
      if (bpmChanged || anchorChanged) this.cancelPendingClicks();
      const songPos = this.currentPosition();
      this.metronomeBpm = songBpm;
      this.metronomeBeatOffset = beatAnchor;
      const secondsPerBeatInSong = 60 / songBpm;
      // Smallest integer N such that anchor + N*period >= songPos.
      // Allows negative N when songPos is before the anchor (pre-anchor
      // bars still get clicks, accent still lands on N%4==0).
      this.metronomeBeatIndex = Math.ceil((songPos - beatAnchor) / secondsPerBeatInSong);
      const beatPosInSong = beatAnchor + this.metronomeBeatIndex * secondsPerBeatInSong;
      this.metronomeNextClickTime = this.ctx.currentTime + (beatPosInSong - songPos) / this.tempo;
    }

    const secondsPerBeatRealtime = 60 / this.metronomeBpm / this.tempo;
    const horizon = this.ctx.currentTime + 0.25;
    while (this.metronomeNextClickTime < horizon) {
      // ((n % 4) + 4) % 4 instead of plain (n % 4): JS gives negative
      // remainders for negative n, so a naive check would put the accent
      // on the wrong beat when N is negative (pre-anchor playback).
      const accent = (((this.metronomeBeatIndex % 4) + 4) % 4) === 0;
      this.scheduleClick(this.metronomeNextClickTime, accent);
      this.metronomeNextClickTime += secondsPerBeatRealtime;
      this.metronomeBeatIndex += 1;
    }
  }

  private scheduleClick(when: number, accent: boolean): void {
    if (!this.ctx) return;
    this.ensureMetronomeGain();
    this.synthesizeClickBuffers();
    const buffer = accent ? this.clickBufferAccent : this.clickBufferRegular;
    if (!buffer || !this.metronomeGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.metronomeGain);
    const playAt = Math.max(when, this.ctx.currentTime);
    try {
      src.start(playAt);
      // Remember it so cancelPendingClicks() can yank future ones when
      // the user re-anchors the bar with "Mark 1".
      const entry = { src, when: playAt };
      this.pendingClickSources.push(entry);
      src.onended = () => {
        const i = this.pendingClickSources.indexOf(entry);
        if (i >= 0) this.pendingClickSources.splice(i, 1);
      };
    } catch {
      // start() can throw if `when` is invalid — skip silently
    }
  }

  /** Stop any clicks that were scheduled but haven't played yet. Called
   *  whenever the anchor / BPM changes so the user hears the new schedule
   *  immediately instead of waiting out the WebAudio look-ahead. */
  private cancelPendingClicks(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const entry of this.pendingClickSources) {
      // If it's already started playing we can't unring the bell — leave it.
      if (entry.when <= now) continue;
      try { entry.src.stop(now); } catch { /* already finished */ }
    }
    // The onended handlers will clean up the array.
  }

  private startRaf(): void {
    if (this.rafId != null) return;
    const tick = () => {
      if (!this.playing) { this.rafId = null; return; }
      this.scheduleMetronomeClicks();
      const pos = this.currentPosition();
      const state = usePlayerStore.getState();

      if (state.loopActive && state.loopA != null && state.loopB != null
          && pos >= state.loopB && state.loopB > state.loopA) {
        this.seek(state.loopA);
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      if (pos >= this.maxDuration() - 0.01) {
        // End-of-song behaviour depends on playMode.
        const mode = state.playMode;
        this.pause();
        this.seek(0);
        if (mode === 'repeat') {
          // Loop the current song
          state.setPlaying(true);
          this.play();
        } else if ((mode === 'continue' || mode === 'shuffle') && this.onRequestNext) {
          // Defer to the hook which knows about the setlist/library
          this.onRequestNext(mode);
        } else {
          state.setPlaying(false);
        }
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
