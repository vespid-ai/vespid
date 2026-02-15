/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../ui/button";

type HeroStat = {
  label: string;
};

type MarketingHeroProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  stats: HeroStat[];
  panel: {
    title: string;
    badge: string;
    steps: string[];
    runLabel: string;
    runId: string;
    runStatus: string;
  };
};

export function MarketingHero({
  eyebrow,
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  stats,
  panel,
}: MarketingHeroProps) {
  const heroRef = useRef<HTMLElement | null>(null);
  const [isInView, setIsInView] = useState(true);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? true;
  }, []);

  useEffect(() => {
    if (!heroRef.current) return;
    const el = heroRef.current;

    if (typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsInView(Boolean(entry?.isIntersecting));
      },
      { threshold: [0, 0.4, 0.85] }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (!isInView) return;
    if (panel.steps.length <= 1) return;

    const interval = window.setInterval(() => {
      setActiveStepIndex((prev) => (prev + 1) % panel.steps.length);
    }, 1200);
    return () => window.clearInterval(interval);
  }, [isInView, panel.steps.length, prefersReducedMotion]);

  const progressPct = panel.steps.length > 0 ? ((activeStepIndex + 1) / panel.steps.length) * 100 : 0;

  return (
    <section ref={heroRef as any} className="relative pt-20 pb-16 sm:pt-28 sm:pb-20">
      <div className="absolute inset-0 -z-10">
        <div className="hero-orb left-[6%] top-10 h-64 w-64 bg-brand/25 blur-3xl pulse-soft" />
        <div className="hero-orb right-[4%] top-20 h-72 w-72 bg-brand2/22 blur-3xl pulse-soft" />
        <div className="hero-orb left-[40%] top-[55%] h-56 w-56 bg-ok/18 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-borderSubtle/60 bg-panel/65 px-4 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-muted shadow-inset">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            {eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.06] tracking-[-0.02em] text-text sm:text-5xl lg:text-6xl font-[var(--font-marketing)]">
            <span className="marketing-title-streak">{title}</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">{subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href={primaryCta.href}>{primaryCta.label}</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="border-borderStrong/70 bg-panel/55 hover:bg-panel/70">
              <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
            </Button>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-borderSubtle/70 bg-panel/60 px-4 py-4 text-sm text-muted shadow-elev1 transition will-change-transform hover:-translate-y-0.5 hover:shadow-elev2"
              >
                <div className="font-medium text-text">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-[28px] bg-surface1/80 shadow-elev3" />
          <div className="grid gap-5 rounded-[28px] border border-borderSubtle/70 bg-surface1/80 p-6 shadow-elev2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.28em] text-muted">{panel.title}</div>
              <div className="inline-flex items-center gap-2 rounded-full border border-borderSubtle/60 bg-panel/70 px-3 py-1 text-xs text-muted shadow-inset">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/40 opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                </span>
                <span>{panel.badge}</span>
              </div>
            </div>
            <div className="grid gap-4">
              {panel.steps.map((step, index) => (
                <div
                  key={step}
                  className={`flex items-center gap-4 rounded-2xl border bg-panel/70 px-4 py-3 text-sm text-muted shadow-inset transition will-change-transform ${
                    index === activeStepIndex && isInView && !prefersReducedMotion
                      ? "border-brand/35 bg-surface2/70 shadow-elev2"
                      : "border-borderSubtle/60 hover:-translate-y-0.5 hover:border-borderStrong/70"
                  }`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/15 text-xs font-semibold text-brand">
                    0{index + 1}
                  </div>
                  <div className="text-text">{step}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-borderSubtle/60 bg-panel/70 px-4 py-4 text-sm text-muted">
              <div className="text-xs uppercase tracking-[0.28em] text-muted">{panel.runLabel}</div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-text">{panel.runId}</span>
                <span className="rounded-full bg-ok/15 px-3 py-1 text-xs font-semibold text-ok">
                  {panel.runStatus}
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface3">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(6, Math.min(100, progressPct))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
