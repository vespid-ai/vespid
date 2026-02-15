import Link from "next/link";
import { Button } from "../ui/button";

export type PricingTier = {
  name: string;
  description: string;
  pricePrimary: string;
  priceSecondary?: string;
  ctaLabel: string;
  ctaHref: string;
  highlight?: boolean;
  highlightLabel?: string;
  features: string[];
};

type PricingProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  tiers: PricingTier[];
  footerNote: string;
};

export function Pricing({ eyebrow, title, subtitle, tiers, footerNote }: PricingProps) {
  return (
    <section id="pricing" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
              {title}
            </h2>
            <p className="mt-3 max-w-xl text-base text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-3xl border bg-panel/60 p-6 shadow-elev2 ${
                tier.highlight
                  ? "border-brand/40 bg-surface2/80 shadow-elev3"
                  : "border-borderSubtle/70"
              }`}
            >
              {tier.highlight && tier.highlightLabel ? (
                <div className="absolute -top-3 right-6 rounded-full bg-brand px-4 py-1 text-xs font-semibold text-brandContrast">
                  {tier.highlightLabel}
                </div>
              ) : null}
              <div className="text-sm uppercase tracking-[0.28em] text-muted">{tier.name}</div>
              <div className="mt-3 text-lg font-semibold text-text">{tier.description}</div>
              <div className="mt-6">
                <div className="text-3xl font-semibold text-text">{tier.pricePrimary}</div>
                {tier.priceSecondary ? (
                  <div className="mt-1 text-sm text-muted">{tier.priceSecondary}</div>
                ) : null}
              </div>
              <div className="mt-6">
                <Button asChild variant={tier.highlight ? "accent" : "outline"} size="lg" className="w-full">
                  <Link href={tier.ctaHref}>{tier.ctaLabel}</Link>
                </Button>
              </div>
              <div className="mt-6 grid gap-3 text-sm text-muted">
                {tier.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 text-sm text-muted">{footerNote}</div>
      </div>
    </section>
  );
}
