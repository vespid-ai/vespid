import Link from "next/link";
import type { ReactNode } from "react";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href={`/${locale}`} className="font-[var(--font-display)] text-lg font-semibold tracking-tight">
          Vespid
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={`/${locale}/workflows`} className="text-muted hover:text-text">
            App
          </Link>
        </nav>
      </header>
      <main className="mt-8">{children}</main>
    </div>
  );
}
