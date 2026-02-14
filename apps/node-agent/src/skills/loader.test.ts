import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillsRegistry } from "./loader.js";

async function mkTmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "vespid-skills-"));
}

describe("skills loader", () => {
  it("loads a valid skill and caps SKILL.md", async () => {
    const root = await mkTmpDir();
    const skillDir = path.join(root, "hello");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "skill.json"),
      JSON.stringify({
        id: "hello",
        version: "1.0.0",
        description: "Hello skill",
        entrypoint: "scripts/run.sh",
        runtime: "shell",
        inputSchema: { type: "object" },
        outputMode: "text",
        sandbox: {},
      }),
      "utf8"
    );
    await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "scripts", "run.sh"), "echo ok", "utf8");
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "x".repeat(1000), "utf8");

    const loaded = await loadSkillsRegistry({ skillsDir: root, maxDocChars: 10 });
    expect(Object.keys(loaded.skills)).toEqual(["hello"]);
    expect(loaded.skills["hello"]?.doc?.length).toBe(10);
  });

  it("rejects skills whose entrypoint escapes the skill directory", async () => {
    const root = await mkTmpDir();
    const skillDir = path.join(root, "bad");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "skill.json"),
      JSON.stringify({
        id: "bad",
        version: "1.0.0",
        description: "Bad skill",
        entrypoint: "../oops.sh",
        runtime: "shell",
        inputSchema: { type: "object" },
        outputMode: "text",
        sandbox: {},
      }),
      "utf8"
    );

    const loaded = await loadSkillsRegistry({ skillsDir: root });
    expect(Object.keys(loaded.skills)).toEqual([]);
  });
});

