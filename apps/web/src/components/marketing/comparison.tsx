type ComparisonRow = {
  label: string;
  vespid: string;
  traditional: string;
  diy: string;
};

type ComparisonProps = {
  eyebrow: string;
  title: string;
  columns: [string, string, string];
  capabilityLabel: string;
  rows: ComparisonRow[];
};

export function Comparison({ eyebrow, title, columns, capabilityLabel, rows }: ComparisonProps) {
  return (
    <section id="compare" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div>
          <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
          <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
            {title}
          </h2>
        </div>

        <div className="mt-10 overflow-hidden rounded-3xl border border-borderSubtle/70 bg-panel/60 shadow-elev2">
          <div className="grid grid-cols-[1.2fr_repeat(3,1fr)] border-b border-borderSubtle/70 bg-surface2/70 text-sm font-semibold text-text">
            <div className="px-5 py-4 text-muted">{capabilityLabel}</div>
            <div className="px-5 py-4 text-center">{columns[0]}</div>
            <div className="px-5 py-4 text-center">{columns[1]}</div>
            <div className="px-5 py-4 text-center">{columns[2]}</div>
          </div>
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1.2fr_repeat(3,1fr)] border-b border-borderSubtle/60 text-sm text-muted last:border-b-0"
            >
              <div className="px-5 py-4 text-text">{row.label}</div>
              <div className="px-5 py-4 text-center font-semibold text-text">{row.vespid}</div>
              <div className="px-5 py-4 text-center">{row.traditional}</div>
              <div className="px-5 py-4 text-center">{row.diy}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
