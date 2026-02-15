type LogoWallProps = {
  title: string;
  logos: string[];
};

export function LogoWall({ title, logos }: LogoWallProps) {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-sm uppercase tracking-[0.3em] text-muted">{title}</div>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {logos.map((logo) => (
            <div
              key={logo}
              className="flex items-center justify-center rounded-2xl border border-borderSubtle/70 bg-panel/55 px-4 py-6 text-sm font-semibold text-text/80 shadow-inset"
            >
              {logo}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
