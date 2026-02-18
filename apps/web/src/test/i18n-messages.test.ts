import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as any;
}

function getPath(obj: any, keyPath: string): unknown {
  const parts = keyPath.split(".").filter(Boolean);
  let cursor: any = obj;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

describe("i18n message coverage", () => {
  it("includes key UI chrome in en and zh-CN", () => {
    const base = path.join(process.cwd(), "messages");
    const en = readJson(path.join(base, "en.json"));
    const zh = readJson(path.join(base, "zh-CN.json"));

    const required = [
      "common.search",
      "common.working",
      "commandPalette.title",
      "settings.title",
      "errors.apiUnreachable.title",
      "workflows.subtitle",
      "workflows.detail.publish",
      "runs.trustTitle",
      "runs.orgLabel",
      "agents.subtitle",
      "agents.installer.title",
      "secrets.createSecret",
      "auth.subtitle",
      "auth.passwordLoginTitle",
      "org.createTitle",
      "advanced.title",
      "providerPicker.title",
      "models.connections.apiKeyPlaceholder",
      "models.connections.apiKeyGroupTitle",
      "models.connections.oauthGroupTitle",
      "onboarding.title",
      "sessions.create.modelChipAria",
      "sessions.chat.shortcutHint",
      "sessions.chat.roleAssistant",
    ];

    for (const key of required) {
      expect(getPath(en, key), `en missing ${key}`).toBeTruthy();
      expect(getPath(zh, key), `zh-CN missing ${key}`).toBeTruthy();
    }
  });
});
