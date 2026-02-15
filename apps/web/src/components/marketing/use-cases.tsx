type UseCaseItem = {
  title: string;
  description: string;
};

type UseCasesProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: UseCaseItem[];
};

export function UseCases({ eyebrow, title, subtitle, items }: UseCasesProps) {
  return (
    <section id="use-cases" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
            <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
              {title}
            </h2>
            <p className="mt-3 max-w-xl text-base text-muted">{subtitle}</p>
          </div>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-6 shadow-elev1"
            >
              <div className="text-base font-semibold text-text">{item.title}</div>
              <p className="mt-2 text-sm text-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
