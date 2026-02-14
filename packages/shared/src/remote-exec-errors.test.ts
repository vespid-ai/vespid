import { describe, expect, it } from "vitest";
import { REMOTE_EXEC_ERROR, isRemoteExecErrorCode } from "./remote-exec-errors.js";

describe("remote exec errors", () => {
  it("recognizes known error codes", () => {
    for (const code of Object.values(REMOTE_EXEC_ERROR)) {
      expect(isRemoteExecErrorCode(code)).toBe(true);
    }
  });

  it("recognizes docker exit code prefix", () => {
    expect(isRemoteExecErrorCode("DOCKER_EXIT_CODE:1")).toBe(true);
    expect(isRemoteExecErrorCode("DOCKER_EXIT_CODE:999")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isRemoteExecErrorCode("RESULT_NOT_READY")).toBe(false);
    expect(isRemoteExecErrorCode("DOCKER_EXIT_CODE:")).toBe(false);
    expect(isRemoteExecErrorCode("DOCKER_EXIT_CODE:abc")).toBe(false);
    expect(isRemoteExecErrorCode(null)).toBe(false);
  });
});

