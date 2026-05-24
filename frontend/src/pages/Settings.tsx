export function Settings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
      <section className="rounded-xl bg-bg-card border border-white/10 p-4">
        <h3 className="font-medium text-text-primary mb-2">Audio</h3>
        <p className="text-sm text-text-muted">Output device and latency can be configured here in a future update.</p>
      </section>
      <section className="rounded-xl bg-bg-card border border-white/10 p-4">
        <h3 className="font-medium text-text-primary mb-2">Storage</h3>
        <p className="text-sm text-text-muted">Songs are stored in ~/Music/SlicerSmthng. Change via SLICERSMTHNG_STORAGE env.</p>
      </section>
      <section className="rounded-xl bg-bg-card border border-white/10 p-4">
        <h3 className="font-medium text-text-primary mb-2">Keyboard shortcuts</h3>
        <ul className="text-sm text-text-secondary space-y-1">
          <li><kbd className="px-1 rounded bg-bg-elevated">Space</kbd> Play / Pause</li>
          <li><kbd className="px-1 rounded bg-bg-elevated">[</kbd> Set loop A</li>
          <li><kbd className="px-1 rounded bg-bg-elevated">]</kbd> Set loop B</li>
          <li><kbd className="px-1 rounded bg-bg-elevated">↑</kbd> <kbd className="px-1 rounded bg-bg-elevated">↓</kbd> Volume</li>
        </ul>
      </section>
    </div>
  );
}
