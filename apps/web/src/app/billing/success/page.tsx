import { headers } from "next/headers";
import { redirect } from "next/navigation";

function localeFromAcceptLanguage(value: string | null): "en" | "zh-CN" {
  const raw = (value ?? "").toLowerCase();
  if (raw.includes("zh")) return "zh-CN";
  return "en";
}

export default async function BillingSuccessPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const orgIdRaw = searchParams.orgId;
  const orgId = typeof orgIdRaw === "string" ? orgIdRaw : Array.isArray(orgIdRaw) ? orgIdRaw[0] : null;

  const acceptLanguage = (await headers()).get("accept-language");
  const locale = localeFromAcceptLanguage(acceptLanguage);

  const url = new URL(`/${locale}/billing`, "http://localhost");
  url.searchParams.set("status", "success");
  if (orgId) {
    url.searchParams.set("orgId", orgId);
  }
  redirect(url.pathname + url.search);
}

