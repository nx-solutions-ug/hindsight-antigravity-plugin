import { describe, expect, test } from "bun:test";
import { handlePreInvocation } from "../src/hooks/pre-invocation.js";
import { handleStop } from "../src/hooks/stop-hook.js";

describe("Antigravity Lifecycle Hooks", () => {
  test("handlePreInvocation gracefully returns valid injectSteps on empty input", async () => {
    const res = await handlePreInvocation("{}");
    expect(res).toBeDefined();
    expect(Array.isArray(res.injectSteps)).toBe(true);
  });

  test("handlePreInvocation handles malformed input without throwing", async () => {
    const res = await handlePreInvocation("not-json");
    expect(res).toBeDefined();
    expect(res.injectSteps).toEqual([]);
  });

  test("handleStop gracefully returns empty object on empty input", async () => {
    const res = await handleStop("{}");
    expect(res).toEqual({});
  });

  test("handleStop handles malformed input without throwing", async () => {
    const res = await handleStop("invalid-json");
    expect(res).toEqual({});
  });
});
