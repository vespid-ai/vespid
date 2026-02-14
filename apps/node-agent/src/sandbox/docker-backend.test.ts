import { describe, expect, it, vi } from "vitest";
import { buildDockerRunArgs } from "./docker-backend.js";

describe("docker backend", () => {
  it("builds hardened docker run args with network none by default", () => {
    const args = buildDockerRunArgs({
      containerName: "vespid-abc",
      image: "node:24-alpine",
      workdirHostPath: "/tmp/vespid/work",
      script: "echo hello",
      shell: "sh",
      env: { FOO: "bar" },
      networkMode: "none",
      limits: { timeoutMs: 30_000, memoryMb: 256, cpus: 1, pids: 256, outputMaxChars: 65_536 },
    });

    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("--security-opt");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("-v");
    expect(args.join(" ")).toContain("/tmp/vespid/work:/work:rw");
    expect(args.join(" ")).toContain("-e FOO=bar");
  });

  it("omits network flag when enabled", () => {
    const args = buildDockerRunArgs({
      containerName: "vespid-abc",
      image: "node:24-alpine",
      workdirHostPath: "/tmp/vespid/work",
      script: "echo hello",
      shell: "sh",
      env: {},
      networkMode: "enabled",
      limits: { timeoutMs: 30_000, memoryMb: 256, cpus: 1, pids: 256, outputMaxChars: 65_536 },
    });

    expect(args.join(" ")).not.toContain("--network none");
  });
});

