import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { OrgSwitcher } from "../components/org-switcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vespid Foundation",
  description: "Foundation slice bootstrap UI",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OrgSwitcher />
        <nav style={{ display: "flex", gap: "1rem", padding: "0.75rem 1rem", borderBottom: "1px solid #ddd" }}>
          <Link href="/auth">Auth</Link>
          <Link href="/org">Org</Link>
          <Link href="/secrets">Secrets</Link>
          <Link href="/workflow">Workflow</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
