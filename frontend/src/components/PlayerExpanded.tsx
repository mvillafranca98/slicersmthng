import { usePlayerStore } from '../stores/playerStore';
import { api } from '../api';

const STEM_COLORS: Record<string, string> = {
  vocals: '#FF6B8A',
  drums: '#FFB347',
  bass: '#00E5C3',
  guitar: '#5BDB6B',
  piano: '#C47FFF',
  other: '#8899AA',
};

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function PlayerExpanded() {
  const {
    currentSong,
    currentTime,
    stems,
    setStem,
    setExpanded,
    loopA,
    loopB,
    loopActive,
    setLoopA,
    setLoopB,
    setLoopActive,
    tempoPercent,
    setTempoPercent,
  } = usePlayerStore();

  if (!currentSong) return null;

  const thumb = currentSong.thumbnail_url || api.thumbnailUrl(currentSong.id);
  const chordEvents = currentSong.chords || [];
  const currentChord = chordEvents.find(c => c.time <= currentTime && (chordEvents[chordEvents.indexOf(c) + 1]?.time ?? Infinity) > currentTime)?.chord ?? '–';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[150] bg-bg-deepest/95 flex flex-col animate-slide-up border-t border-white/10" style={{ height: '72vh' }}>
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <img src={thumb} alt="" className="w-14 h-14 rounded-lg object-cover" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{currentSong.title}</h2>
            <p className="text-sm text-text-secondary">{currentSong.artist}</p>
            <div className="flex gap-2 mt-1">
              <span className="text-xs font-mono text-text-muted">♩ {currentSong.bpm}</span>
              <span className="text-xs text-text-muted">{currentSong.key}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="p-2 rounded-lg bg-bg-elevated text-text-secondary hover:text-text-primary"
          aria-label="Collapse player"
        >
          ↓ Collapse
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <section>
          <h3 className="text-sm font-medium text-text-secondary mb-2">Chord</h3>
          <div className="h-10 flex items-center justify-center rounded-lg bg-bg-card border border-white/10">
            <span className="text-2xl font-bold text-text-primary">{currentChord}</span>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-medium text-text-secondary mb-2">Stem mixer</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {(currentSong.stems || []).map(name => {
              const st = stems[name] || { volume: 1, muted: false, solo: false };
              const color = STEM_COLORS[name] || '#8899AA';
              return (
                <div
                  key={name}
                  className="rounded-xl bg-bg-card border border-white/10 p-3 flex flex-col gap-2"
                  style={{ borderLeftWidth: 4, borderLeftColor: color }}
                >
                  <p className="text-sm font-medium text-text-primary capitalize truncate">{name}</p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setStem(name, { solo: !st.solo })}
                      className={`px-2 py-1 rounded text-xs ${st.solo ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary'}`}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      onClick={() => setStem(name, { muted: !st.muted })}
                      className={`px-2 py-1 rounded text-xs ${st.muted ? 'bg-accent-red text-white' : 'bg-bg-elevated text-text-secondary'}`}
                    >
                      M
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={st.volume}
                      onChange={e => setStem(name, { volume: Number(e.target.value) })}
                      className="flex-1"
                    />
                    <span className="text-xs font-mono w-8">{Math.round(st.volume * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="text-sm text-text-secondary block mb-1">Tempo</label>
            <div className="flex gap-1">
              {[50, 75, 90, 100].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setTempoPercent(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${tempoPercent === p ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary'}`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-text-secondary block mb-1">Loop A/B</label>
            <div className="flex gap-2 items-center">
              <button
                type="button"
                onClick={() => setLoopA(currentTime)}
                className="px-2 py-1 rounded bg-bg-elevated text-xs font-mono"
              >
                [ A
              </button>
              <button
                type="button"
                onClick={() => setLoopB(currentTime)}
                className="px-2 py-1 rounded bg-bg-elevated text-xs font-mono"
              >
                B ]
              </button>
              <button
                type="button"
                onClick={() => setLoopActive(!loopActive)}
                className={`px-2 py-1 rounded text-xs ${loopActive ? 'bg-primary' : 'bg-bg-elevated'}`}
              >
                {loopActive ? 'On' : 'Off'}
              </button>
              {(loopA != null || loopB != null) && (
                <span className="text-xs text-text-muted font-mono">
                  {loopA != null ? formatTime(loopA) : '–'} – {loopB != null ? formatTime(loopB) : '–'}
                </span>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
