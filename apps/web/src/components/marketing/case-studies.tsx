type CaseStudyItem = {
  title: string;
  description: string;
  metric: string;
};

type CaseStudiesProps = {
  eyebrow: string;
  title: string;
  items: CaseStudyItem[];
};

export function CaseStudies({ eyebrow, title, items }: CaseStudiesProps) {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
            <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
              {title}
            </h2>
          </div>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-6 shadow-elev1"
            >
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold text-text">{item.title}</div>
                <span className="rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold text-brand">
                  {item.metric}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
