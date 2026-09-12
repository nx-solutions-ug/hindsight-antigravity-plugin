import { describe, expect, test } from "bun:test";
import {
  APP_MCP_CONFIG_PATH,
  HOOKS_CONFIG_PATH,
  HOOK_NAME,
  HOOK_WIRING,
  HOST,
  MCP_HARNESS_ENV,
  MCP_SERVER_NAME,
  PLUGIN_DIR,
  PLUGIN_NAME,
  RUNTIME_HARNESS,
  RUNTIME_PACKAGE,
  SHARED_MCP_CONFIG_PATH,
  SKILL_NAME,
  type PluginBin,
  type RuntimeEntry
} from "../src/host.js";

describe("Host constants", () => {
  test("name the Antigravity desktop app as the host", () => {
    expect(HOST).toBe("antigravity");
    expect(PLUGIN_NAME).toBe("hindsight");
    expect(MCP_SERVER_NAME).toBe("hindsight");
    expect(HOOK_NAME).toBe("coding-agents");
    expect(SKILL_NAME).toBe("hindsight-coding-agent");
    expect(MCP_HARNESS_ENV).toBe("HINDSIGHT_MCP_HARNESS");
    expect(RUNTIME_PACKAGE).toBe("@vectorize-io/hindsight-coding-agents");
  });

  test("keep the runtime's own harness id, which its hook entry points hardcode", () => {
    // `antigravity-hook.js` calls runHarnessPrompt("antigravity-cli") with no way to override it.
    // Renaming this would split the hooks and the MCP tools across two config sections — and
    // potentially two banks — for one session.
    expect(RUNTIME_HARNESS).toBe("antigravity-cli");
    // It is the runtime's protocol id, not the host: those two are deliberately separate values.
    expect(RUNTIME_HARNESS).not.toBe(HOST);
  });
});

describe("Host paths", () => {
  const paths = {
    HOOKS_CONFIG_PATH,
    APP_MCP_CONFIG_PATH,
    SHARED_MCP_CONFIG_PATH,
    PLUGIN_DIR
  };

  test("are home-relative and land under Antigravity's .gemini tree", () => {
    for (const [name, parts] of Object.entries(paths)) {
      expect(parts.length, name).toBeGreaterThan(0);
      expect(parts[0], name).toBe(".gemini");
      for (const part of parts) {
        expect(part.startsWith("/"), name).toBe(false);
        expect(part, name).not.toBe("..");
      }
    }
  });

  test("send the MCP registration to the app's own config directory", () => {
    expect([...APP_MCP_CONFIG_PATH]).toEqual([".gemini", "antigravity", "mcp_config.json"]);
  });

  test("send hooks, the plugin bundle and the shared MCP file to the host-wide config tree", () => {
    expect([...HOOKS_CONFIG_PATH]).toEqual([".gemini", "config", "hooks.json"]);
    expect([...SHARED_MCP_CONFIG_PATH]).toEqual([".gemini", "config", "mcp_config.json"]);
    expect([...PLUGIN_DIR]).toEqual([".gemini", "config", "plugins", PLUGIN_NAME]);
  });

  test("touch nothing belonging to the Antigravity CLI", () => {
    // `agy` keeps its settings (and its status line) in ~/.gemini/antigravity-cli, and stages its
    // plugins there too. Upstream's `install agy` owns that tree; this plugin must not write to it.
    for (const [name, parts] of Object.entries(paths)) {
      expect(parts as readonly string[], name).not.toContain("antigravity-cli");
      expect(parts as readonly string[], name).not.toContain("settings.json");
    }
  });

  test("the two MCP registries are distinct files", () => {
    expect([...APP_MCP_CONFIG_PATH]).not.toEqual([...SHARED_MCP_CONFIG_PATH]);
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

  test("names no status-line wiring: the desktop app has no status line to render one in", () => {
    const entries: RuntimeEntry[] = HOOK_WIRING.map((w) => w.entry);
    const bins: PluginBin[] = HOOK_WIRING.map((w) => w.bin);
    expect(entries.join()).not.toContain("statusline");
    expect(bins.join()).not.toContain("statusline");
  });
});
