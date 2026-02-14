import { describe, expect, it } from "vitest";
import { ensureLocalePrefix, replaceLocaleInPathname } from "../i18n/pathnames";

describe("i18n pathnames", () => {
  it("redirects root to /en", () => {
    expect(ensureLocalePrefix("/")).toBe("/en");
  });

  it("prefixes non-locale pathnames", () => {
    expect(ensureLocalePrefix("/auth")).toBe("/en/auth");
  });

  it("keeps locale-prefixed pathnames", () => {
    expect(ensureLocalePrefix("/zh-CN/auth")).toBe("/zh-CN/auth");
  });

  it("replaces locale while keeping path", () => {
    expect(replaceLocaleInPathname("/en/workflows/123", "zh-CN")).toBe("/zh-CN/workflows/123");
  });
});
