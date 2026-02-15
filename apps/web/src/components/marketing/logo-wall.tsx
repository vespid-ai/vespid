type LogoWallProps = {
  title: string;
  subtitle: string;
  logos: string[];
};

export function LogoWall({ title, subtitle, logos }: LogoWallProps) {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-sm uppercase tracking-[0.3em] text-muted">{title}</div>
        <div className="mt-2 text-sm text-muted">{subtitle}</div>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {logos.map((logo) => (
            <div
              key={logo}
              className="group relative flex items-center justify-center overflow-hidden rounded-2xl border border-borderStrong/55 bg-panel/55 px-4 py-6 text-center text-xs font-semibold uppercase tracking-[0.16em] text-text/80 shadow-inset transition will-change-transform hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-elev2"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.75),transparent_52%),radial-gradient(circle_at_84%_86%,rgba(56,189,248,0.20),transparent_55%)] opacity-0 transition-opacity group-hover:opacity-100" />
              {logo}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
