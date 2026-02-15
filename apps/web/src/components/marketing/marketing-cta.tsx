import Link from "next/link";
import { Button } from "../ui/button";

type MarketingCtaProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  contactTitle: string;
  contactSubtitle: string;
  contactEmail: string;
};

export function MarketingCta({
  eyebrow,
  title,
  subtitle,
  primaryCta,
  contactTitle,
  contactSubtitle,
  contactEmail,
}: MarketingCtaProps) {
  return (
    <section id="contact" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-6 rounded-[32px] border border-borderSubtle/70 bg-surface1/70 p-8 shadow-elev2 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
            <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
              {title}
            </h2>
            <p className="mt-3 text-base text-muted">{subtitle}</p>
            <div className="mt-6">
              <Button asChild variant="accent" size="lg">
                <Link href={primaryCta.href}>{primaryCta.label}</Link>
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-6">
            <div className="text-sm uppercase tracking-[0.28em] text-muted">{contactTitle}</div>
            <div className="mt-3 text-base font-semibold text-text">{contactEmail}</div>
            <p className="mt-2 text-sm text-muted">{contactSubtitle}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
