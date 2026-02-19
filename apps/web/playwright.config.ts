import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? process.env.WEB_PORT ?? 3020);
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${webPort}`;

const config = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../output/playwright/web-report" }]],
  outputDir: "../../output/playwright/web-test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: `WEB_PORT=${webPort} pnpm --filter @vespid/web dev`,
          url: `${baseURL}/zh-CN/models`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});

export default config;
