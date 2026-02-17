import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";

function NavLabels() {
  const t = useTranslations();
  return (
    <div>
      <span>{t("nav.workflows")}</span>
      <span>{t("nav.channels")}</span>
    </div>
  );
}

describe("next-intl messages", () => {
  it("renders en labels", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{
          nav: { workflows: "Workflows", channels: "Channels" },
        }}
      >
        <NavLabels />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Workflows")).toBeInTheDocument();
    expect(screen.getByText("Channels")).toBeInTheDocument();
  });

  it("renders zh-CN labels", () => {
    render(
      <NextIntlClientProvider
        locale="zh-CN"
        messages={{
          nav: { workflows: "工作流", channels: "渠道" },
        }}
      >
        <NavLabels />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("工作流")).toBeInTheDocument();
    expect(screen.getByText("渠道")).toBeInTheDocument();
  });
});
