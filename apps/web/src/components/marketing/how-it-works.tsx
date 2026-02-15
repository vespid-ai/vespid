type StepItem = {
  title: string;
  description: string;
};

type HowItWorksProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: StepItem[];
};

export function HowItWorks({ eyebrow, title, subtitle, steps }: HowItWorksProps) {
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
          <div className="text-sm text-muted">{subtitle}</div>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="relative rounded-2xl border border-borderSubtle/70 bg-panel/60 p-6 shadow-elev1"
            >
              <div className="absolute right-5 top-5 text-xs font-semibold text-muted">0{index + 1}</div>
              <div className="text-lg font-semibold text-text">{step.title}</div>
              <p className="mt-3 text-sm text-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
