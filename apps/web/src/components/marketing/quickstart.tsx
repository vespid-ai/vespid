import Link from "next/link";
import { Button } from "../ui/button";

type QuickstartStep = {
  timeLabel: string;
  title: string;
  description: string;
};

type QuickstartProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: QuickstartStep[];
  artifact: {
    title: string;
    subtitle: string;
    dslSnippet: string;
    events: string[];
    callout: string;
    ctaLabel: string;
    ctaHref: string;
  };
};

export function Quickstart({ eyebrow, title, subtitle, steps, artifact }: QuickstartProps) {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div>
            <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
            <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
              {title}
            </h2>
            <p className="mt-3 max-w-xl text-base text-muted">{subtitle}</p>

            <div className="mt-8 grid gap-4">
              {steps.map((step, index) => (
                <div
                  key={step.title}
                  className="relative rounded-2xl border border-borderSubtle/70 bg-panel/60 p-5 shadow-elev1 transition will-change-transform hover:-translate-y-0.5 hover:border-borderStrong/70 hover:shadow-elev2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text">
                        <span className="mr-2 text-muted">0{index + 1}</span>
                        {step.title}
                      </div>
                      <p className="mt-2 text-sm text-muted">{step.description}</p>
                    </div>
                    <div className="rounded-full border border-borderSubtle/70 bg-surface2/70 px-3 py-1 text-xs font-semibold text-muted shadow-inset">
                      {step.timeLabel}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 -z-10 rounded-[28px] bg-surface1/80 shadow-elev3" />
            <div className="overflow-hidden rounded-[28px] border border-borderSubtle/70 bg-surface1/80 shadow-elev2">
              <div className="border-b border-borderSubtle/70 bg-panel/70 px-6 py-5">
                <div className="text-xs uppercase tracking-[0.28em] text-muted">{artifact.title}</div>
                <div className="mt-2 text-sm font-semibold text-text">{artifact.subtitle}</div>
              </div>

              <div className="grid gap-5 px-6 py-6">
                <div className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-4 shadow-inset">
                  <div className="text-xs uppercase tracking-[0.28em] text-muted">DSL</div>
                  <pre className="mt-3 max-h-44 overflow-auto rounded-xl bg-surface2/60 p-3 text-xs text-text/90">
                    <code>{artifact.dslSnippet}</code>
                  </pre>
                </div>

                <div className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-4 shadow-inset">
                  <div className="text-xs uppercase tracking-[0.28em] text-muted">Events</div>
                  <div className="mt-3 grid gap-2 font-mono text-xs text-muted">
                    {artifact.events.map((line) => (
                      <div key={line} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand/70" />
                        <span className="truncate">{line}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-brand/25 bg-brand/10 px-4 py-4 text-sm text-text">
                  {artifact.callout}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button asChild variant="accent" size="lg">
                    <Link href={artifact.ctaHref}>{artifact.ctaLabel}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

