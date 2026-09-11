import { describe, expect, test } from "bun:test";
import {
  HARNESS,
  HOOKS_CONFIG_PATH,
  HOOK_MARKER,
  HOOK_WIRING,
  MCP_CONFIG_PATH,
  MCP_HARNESS_ENV,
  MCP_SERVER_NAME,
  RUNTIME_PACKAGE,
  SETTINGS_PATH,
  SKILLS_DIR,
  SKILL_NAME,
  type PluginBin,
  type RuntimeEntry
} from "../src/harness.js";

describe("Harness constants", () => {
  test("name the upstream harness this plugin packages", () => {
    expect(HARNESS).toBe("antigravity-cli");
    expect(RUNTIME_PACKAGE).toBe("@vectorize-io/hindsight-coding-agents");
    expect(HOOK_MARKER).toBe("coding-agents");
    expect(SKILL_NAME).toBe("hindsight-coding-agent");
    expect(MCP_SERVER_NAME).toBe("hindsight");
    expect(MCP_HARNESS_ENV).toBe("HINDSIGHT_MCP_HARNESS");
  });

  test("host config paths are home-relative and land under Antigravity's .gemini tree", () => {
    for (const parts of [HOOKS_CONFIG_PATH, MCP_CONFIG_PATH, SETTINGS_PATH, SKILLS_DIR]) {
      expect(parts.length).toBeGreaterThan(0);
      expect(parts[0]).toBe(".gemini");
      // Home-relative: no absolute segment, no traversal.
      for (const part of parts) {
        expect(part.startsWith("/")).toBe(false);
        expect(part).not.toBe("..");
      }
    }

    expect([...HOOKS_CONFIG_PATH]).toEqual([".gemini", "config", "hooks.json"]);
    expect([...MCP_CONFIG_PATH]).toEqual([".gemini", "config", "mcp_config.json"]);
    expect([...SETTINGS_PATH]).toEqual([".gemini", HARNESS, "settings.json"]);
    expect([...SKILLS_DIR]).toEqual([".gemini", "config", "skills"]);
  });
});

describe("Hook wiring", () => {
  test("wires PreInvocation and Stop, each exactly once", () => {
    const events = HOOK_WIRING.map((wiring) => wiring.event);
    expect(events).toEqual(["PreInvocation", "Stop"]);
    expect(new Set(events).size).toBe(events.length);
  });

  test("pairs each event with its runtime entry and this package's wrapper", () => {
    const byEvent = new Map(HOOK_WIRING.map((wiring) => [wiring.event, wiring]));

    const pre = byEvent.get("PreInvocation");
    expect(pre?.entry).toBe("antigravity-hook.js" satisfies RuntimeEntry);
    expect(pre?.bin).toBe("pre-invocation.js" satisfies PluginBin);

    const stop = byEvent.get("Stop");
    expect(stop?.entry).toBe("antigravity-stop-hook.js" satisfies RuntimeEntry);
    expect(stop?.bin).toBe("stop-hook.js" satisfies PluginBin);
  });

  test("every wiring uses a distinct entry and wrapper", () => {
    expect(new Set(HOOK_WIRING.map((w) => w.entry)).size).toBe(HOOK_WIRING.length);
    expect(new Set(HOOK_WIRING.map((w) => w.bin)).size).toBe(HOOK_WIRING.length);
  });

  test("timeouts are 30 seconds — Antigravity's unit, not milliseconds", () => {
    for (const wiring of HOOK_WIRING) {
      expect(wiring.timeout).toBe(30);
      expect(Number.isInteger(wiring.timeout)).toBe(true);
      // A milliseconds value would be three orders of magnitude larger; guard the unit explicitly.
      expect(wiring.timeout).toBeLessThan(1000);
    }
  });
});
