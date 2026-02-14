import { defaultLocale, isLocale, type Locale } from "./routing";

export function getLocaleFromPathname(pathname: string): Locale {
  const [, segment] = pathname.split("/");
  if (segment && isLocale(segment)) {
    return segment;
  }
  return defaultLocale;
}

export function replaceLocaleInPathname(pathname: string, nextLocale: Locale): string {
  const parts = pathname.split("/");
  if (parts.length <= 1) {
    return `/${nextLocale}`;
  }
  parts[1] = nextLocale;
  return parts.join("/");
}

export function ensureLocalePrefix(pathname: string, locale: Locale = defaultLocale): string {
  if (pathname === "/") {
    return `/${locale}`;
  }

  const current = getLocaleFromPathname(pathname);
  if (current !== defaultLocale || pathname.startsWith(`/${current}/`) || pathname === `/${current}`) {
    // Already has a locale prefix.
    return pathname;
  }

  return `/${locale}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
}
