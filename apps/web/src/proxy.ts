import createMiddleware from "next-intl/middleware";
import { defaultLocale, locales } from "./i18n/routing";

export default createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
});

export const config = {
  // Match all pathnames except for:
  // - _next (Next.js internals)
  // - files with extensions (static assets)
  matcher: ["/((?!_next|.*\\..*).*)"],
};
