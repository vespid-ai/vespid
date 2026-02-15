type FeatureItem = {
  title: string;
  description: string;
};

type FeatureGridProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: FeatureItem[];
};

export function FeatureGrid({ eyebrow, title, subtitle, items }: FeatureGridProps) {
  return (
    <section id="product" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
            <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
              {title}
            </h2>
            <p className="mt-4 max-w-lg text-base text-muted">{subtitle}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-5 shadow-elev1 transition will-change-transform hover:-translate-y-0.5 hover:border-borderStrong/70 hover:shadow-elev2"
              >
                <div className="text-base font-semibold text-text">{item.title}</div>
                <p className="mt-2 text-sm text-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
