"use client";

import Link from "next/link";
import { Fraunces } from "next/font/google";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "../../lib/hooks/use-session";
import { Button } from "../../components/ui/button";
import { MarketingShell } from "../../components/marketing/marketing-shell";
import { MarketingHero } from "../../components/marketing/marketing-hero";
import { LogoWall } from "../../components/marketing/logo-wall";
import { FeatureGrid } from "../../components/marketing/feature-grid";
import { HowItWorks } from "../../components/marketing/how-it-works";
import { Quickstart } from "../../components/marketing/quickstart";
import { UseCases } from "../../components/marketing/use-cases";
import { CaseStudies } from "../../components/marketing/case-studies";
import { Comparison } from "../../components/marketing/comparison";
import { Pricing } from "../../components/marketing/pricing";
import { Faq } from "../../components/marketing/faq";
import { MarketingCta } from "../../components/marketing/marketing-cta";
import { MarketingFooter } from "../../components/marketing/marketing-footer";

const marketingDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-marketing",
  weight: ["400", "500", "600", "700"],
});

export default function LocaleHomePage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";
  const session = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (session.isLoading) {
      return;
    }

    if (session.data?.session) {
      router.replace(`/${locale}/conversations`);
    }
  }, [locale, router, session.data, session.isLoading]);

  const navItems = [
    { href: "#product", label: t("marketing.nav.product") },
    { href: "#use-cases", label: t("marketing.nav.useCases") },
    { href: "#compare", label: t("marketing.nav.compare") },
    { href: "#pricing", label: t("marketing.nav.pricing") },
    { href: "#faq", label: t("marketing.nav.faq") },
  ];

  const logos = [
    "fintech",
    "healthcare",
    "retailOps",
    "soc2Ready",
    "rlsDefault",
    "auditTrails",
  ].map((key) => t(`marketing.logos.items.${key}`));

  const featureItems = [
    "orgIsolation",
    "workflowDsl",
    "queueFirst",
    "nodeBrowser",
    "auditReady",
    "connectors",
  ].map((key) => ({
    title: t(`marketing.features.items.${key}.title`),
    description: t(`marketing.features.items.${key}.description`),
  }));

  const steps = ["design", "publish", "observe"].map((key) => ({
    title: t(`marketing.how.steps.${key}.title`),
    description: t(`marketing.how.steps.${key}.description`),
  }));

  const useCases = [
    "onboarding",
    "compliance",
    "revenueOps",
    "reconciliation",
    "supportRouting",
    "postmortems",
  ].map((key) => ({
    title: t(`marketing.useCases.items.${key}.title`),
    description: t(`marketing.useCases.items.${key}.description`),
  }));

  const caseStudies = ["logistics", "fintech", "retail"].map((key) => ({
    title: t(`marketing.caseStudies.items.${key}.title`),
    description: t(`marketing.caseStudies.items.${key}.description`),
    metric: t(`marketing.caseStudies.items.${key}.metric`),
  }));

  const comparisonRows = [
    "time",
    "reliability",
    "isolation",
    "audit",
    "connectors",
    "governance",
  ].map((key) => ({
    label: t(`marketing.comparison.rows.${key}.label`),
    vespid: t(`marketing.comparison.rows.${key}.vespid`),
    traditional: t(`marketing.comparison.rows.${key}.traditional`),
    diy: t(`marketing.comparison.rows.${key}.diy`),
  }));

  const pricingTiers = [
    {
      name: t("marketing.pricing.tiers.starter.title"),
      description: t("marketing.pricing.tiers.starter.description"),
      pricePrimary: t("marketing.pricing.tiers.starter.pricePrimary"),
      priceSecondary: t("marketing.pricing.tiers.starter.priceSecondary"),
      ctaLabel: t("marketing.pricing.tiers.starter.cta"),
      ctaHref: `/${locale}/auth`,
      features: [
        t("marketing.pricing.features.starter.workflowBuilder"),
        t("marketing.pricing.features.starter.standardAgents"),
        t("marketing.pricing.features.starter.sharedQueue"),
        t("marketing.pricing.features.starter.communityConnectors"),
      ],
    },
    {
      name: t("marketing.pricing.tiers.team.title"),
      description: t("marketing.pricing.tiers.team.description"),
      pricePrimary: t("marketing.pricing.tiers.team.pricePrimary"),
      priceSecondary: t("marketing.pricing.tiers.team.priceSecondary"),
      ctaLabel: t("marketing.pricing.tiers.team.cta"),
      ctaHref: `/${locale}/auth`,
      highlight: true,
      highlightLabel: t("marketing.pricing.highlight"),
      features: [
        t("marketing.pricing.features.team.priorityQueue"),
        t("marketing.pricing.features.team.advancedRuns"),
        t("marketing.pricing.features.team.nodeExecution"),
        t("marketing.pricing.features.team.auditExport"),
      ],
    },
    {
      name: t("marketing.pricing.tiers.enterprise.title"),
      description: t("marketing.pricing.tiers.enterprise.description"),
      pricePrimary: t("marketing.pricing.tiers.enterprise.pricePrimary"),
      ctaLabel: t("marketing.pricing.tiers.enterprise.cta"),
      ctaHref: "#contact",
      features: [
        t("marketing.pricing.features.enterprise.dedicatedVpc"),
        t("marketing.pricing.features.enterprise.slaSupport"),
        t("marketing.pricing.features.enterprise.customConnectors"),
        t("marketing.pricing.features.enterprise.ssoSaml"),
      ],
    },
  ];

  const faqItems = ["data", "infra", "queue", "start", "locale"].map((key) => ({
    question: t(`marketing.faq.items.${key}.question`),
    answer: t(`marketing.faq.items.${key}.answer`),
  }));

  return (
    <MarketingShell>
      <div className={`${marketingDisplay.variable} font-sans text-text`}>
        <header className="sticky top-0 z-20 border-b border-borderSubtle/70 bg-surface0/88 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
            <Link href={`/${locale}`} className="text-lg font-semibold text-text">
              Vespid
            </Link>
            <nav className="hidden items-center gap-4 text-sm text-muted md:flex">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} className="hover:text-text">
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2 sm:gap-3">
              {session.isLoading ? (
                <span className="hidden text-xs text-muted sm:inline">{t("common.loading")}</span>
              ) : null}
              <Button asChild variant="accent" size="md" className="h-8 px-3 sm:h-9 sm:px-4">
                <Link href={`/${locale}/auth`}>{t("marketing.hero.ctaPrimary")}</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="md:hidden"
                aria-label={mobileMenuOpen ? t("common.close") : t("common.nav")}
                onClick={() => setMobileMenuOpen((v) => !v)}
              >
                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {mobileMenuOpen ? (
            <div className="border-t border-borderSubtle/70 px-6 py-3 md:hidden">
              <nav className="grid gap-2 text-sm text-muted">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-[var(--radius-sm)] border border-borderSubtle/70 bg-panel/70 px-3 py-2 hover:text-text"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          ) : null}
        </header>

        <MarketingHero
          eyebrow={t("marketing.hero.eyebrow")}
          title={t("marketing.hero.title")}
          subtitle={t("marketing.hero.subtitle")}
          primaryCta={{ label: t("marketing.hero.ctaPrimary"), href: `/${locale}/auth` }}
          secondaryCta={{ label: t("marketing.hero.ctaSecondary"), href: "#contact" }}
          stats={[
            { label: t("marketing.hero.stats.rls") },
            { label: t("marketing.hero.stats.queue") },
            { label: t("marketing.hero.stats.runtime") },
          ]}
          panel={{
            title: t("marketing.hero.panel.title"),
            badge: t("marketing.hero.panel.badge"),
            steps: [
              t("marketing.hero.panel.steps.intake"),
              t("marketing.hero.panel.steps.reasoning"),
              t("marketing.hero.panel.steps.connector"),
              t("marketing.hero.panel.steps.node"),
              t("marketing.hero.panel.steps.audit"),
            ],
            runLabel: t("marketing.hero.panel.runLabel"),
            runId: t("marketing.hero.panel.runId"),
            runStatus: t("marketing.hero.panel.runStatus"),
          }}
        />

        <Quickstart
          eyebrow={t("marketing.quickstart.eyebrow")}
          title={t("marketing.quickstart.title")}
          subtitle={t("marketing.quickstart.subtitle")}
          steps={[
            {
              timeLabel: t("marketing.quickstart.steps.signIn.time"),
              title: t("marketing.quickstart.steps.signIn.title"),
              description: t("marketing.quickstart.steps.signIn.description"),
            },
            {
              timeLabel: t("marketing.quickstart.steps.pick.time"),
              title: t("marketing.quickstart.steps.pick.title"),
              description: t("marketing.quickstart.steps.pick.description"),
            },
            {
              timeLabel: t("marketing.quickstart.steps.run.time"),
              title: t("marketing.quickstart.steps.run.title"),
              description: t("marketing.quickstart.steps.run.description"),
            },
          ]}
          artifact={{
            title: t("marketing.quickstart.artifact.title"),
            subtitle: t("marketing.quickstart.artifact.subtitle"),
            dslSnippet: String(t.raw("marketing.quickstart.artifact.dslSnippet")),
            events: [
              t("marketing.quickstart.artifact.events.started"),
              t("marketing.quickstart.artifact.events.nodeStarted"),
              t("marketing.quickstart.artifact.events.nodeSucceeded"),
              t("marketing.quickstart.artifact.events.runSucceeded"),
            ],
            callout: t("marketing.quickstart.artifact.callout"),
            ctaLabel: t("marketing.quickstart.artifact.cta"),
            ctaHref: `/${locale}/auth`,
          }}
        />

        <LogoWall title={t("marketing.logos.title")} subtitle={t("marketing.logos.subtitle")} logos={logos} />

        <FeatureGrid
          eyebrow={t("marketing.features.eyebrow")}
          title={t("marketing.features.title")}
          subtitle={t("marketing.features.subtitle")}
          items={featureItems}
        />

        <HowItWorks
          eyebrow={t("marketing.how.eyebrow")}
          title={t("marketing.how.title")}
          subtitle={t("marketing.how.subtitle")}
          steps={steps}
        />

        <UseCases
          eyebrow={t("marketing.useCases.eyebrow")}
          title={t("marketing.useCases.title")}
          subtitle={t("marketing.useCases.subtitle")}
          items={useCases}
        />

        <CaseStudies eyebrow={t("marketing.caseStudies.eyebrow")} title={t("marketing.caseStudies.title")} items={caseStudies} />

        <Comparison
          eyebrow={t("marketing.comparison.eyebrow")}
          title={t("marketing.comparison.title")}
          capabilityLabel={t("marketing.comparison.capabilityLabel")}
          columns={[
            t("marketing.comparison.columns.vespid"),
            t("marketing.comparison.columns.traditional"),
            t("marketing.comparison.columns.diy"),
          ]}
          rows={comparisonRows}
        />

        <Pricing
          eyebrow={t("marketing.pricing.eyebrow")}
          title={t("marketing.pricing.title")}
          subtitle={t("marketing.pricing.subtitle")}
          tiers={pricingTiers}
          footerNote={t("marketing.pricing.footerNote")}
        />

        <Faq eyebrow={t("marketing.faq.eyebrow")} title={t("marketing.faq.title")} items={faqItems} />

        <MarketingCta
          eyebrow={t("marketing.cta.eyebrow")}
          title={t("marketing.cta.title")}
          subtitle={t("marketing.cta.subtitle")}
          primaryCta={{ label: t("marketing.cta.ctaPrimary"), href: `/${locale}/auth` }}
          contactTitle={t("marketing.cta.contactTitle")}
          contactSubtitle={t("marketing.cta.contactSubtitle")}
          contactEmail={t("marketing.cta.contactEmail")}
        />

        <MarketingFooter
          copyright={t("marketing.footer.copyright")}
          links={[
            { label: t("marketing.footer.terms"), href: "#" },
            { label: t("marketing.footer.privacy"), href: "#" },
          ]}
        />
      </div>
    </MarketingShell>
  );
}
