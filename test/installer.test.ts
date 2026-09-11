import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  HOOKS_CONFIG_PATH,
  HOOK_MARKER,
  HOOK_WIRING,
  MCP_CONFIG_PATH,
  MCP_HARNESS_ENV,
  MCP_SERVER_NAME,
  SETTINGS_PATH,
  SKILLS_DIR,
  SKILL_NAME
} from "../src/harness.js";
import {
  binPath,
  hookEntry,
  install,
  isOurMcpEntry,
  mcpServerEntry,
  uninstall,
  type InstallContext
} from "../src/installer.js";

let home: string;
let pkgRoot: string;
let logged: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hindsight-home-"));
  pkgRoot = mkdtempSync(join(tmpdir(), "hindsight-pkg-"));
  logged = [];

  // A plausible package layout: the wrappers the host spawns, and the bundled skill.
  mkdirSync(join(pkgRoot, "bin"), { recursive: true });
  for (const bin of ["pre-invocation.js", "stop-hook.js", "statusline.js", "mcp-server.js"]) {
    writeFileSync(join(pkgRoot, "bin", bin), "#!/usr/bin/env node\n");
  }
  mkdirSync(join(pkgRoot, "skills", SKILL_NAME), { recursive: true });
  writeFileSync(join(pkgRoot, "skills", SKILL_NAME, "SKILL.md"), "# Hindsight\n");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(pkgRoot, { recursive: true, force: true });
});

const ctx = (): InstallContext => ({ home, pkgRoot, log: (message) => void logged.push(message) });

const hooksPath = (): string => join(home, ...HOOKS_CONFIG_PATH);
const mcpPath = (): string => join(home, ...MCP_CONFIG_PATH);
const settingsPath = (): string => join(home, ...SETTINGS_PATH);
const skillDir = (): string => join(home, ...SKILLS_DIR, SKILL_NAME);

function readJsonFile(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed).toBeObject();
  return parsed as Record<string, unknown>;
}

function seed(path: string, value: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
  return text;
}

/** The object under `hooks.json`'s marker key, which is where our entries live. */
function hookGroup(): Record<string, unknown> {
  const group = readJsonFile(hooksPath())[HOOK_MARKER];
  expect(group).toBeObject();
  return group as Record<string, unknown>;
}

function entriesAt(container: Record<string, unknown>, event: string): Record<string, unknown>[] {
  const value = container[event];
  if (value === undefined) return [];
  expect(value).toBeArray();
  return value as Record<string, unknown>[];
}

const FOREIGN_HOOK = { command: "node /opt/other-tool/pre.js", timeout: 5 };
const FOREIGN_MCP = { command: "npx", args: ["-y", "some-other-hindsight"] };
const FOREIGN_STATUS_LINE = { type: "command", command: "node /opt/my-own-statusline.js" };

describe("Installer path helpers", () => {
  test("binPath points at this package's wrapper", () => {
    expect(binPath("/pkg", "pre-invocation.js")).toBe(join("/pkg", "bin", "pre-invocation.js"));
  });

  test("hookEntry is Antigravity's flat style, with the timeout in seconds", () => {
    for (const wiring of HOOK_WIRING) {
      expect(hookEntry("/pkg", wiring)).toEqual({
        command: `node "${join("/pkg", "bin", wiring.bin)}"`,
        timeout: 30
      });
    }
  });

  test("mcpServerEntry spawns our wrapper and names the harness", () => {
    expect(mcpServerEntry("/pkg")).toEqual({
      command: "node",
      args: [join("/pkg", "bin", "mcp-server.js")],
      env: { [MCP_HARNESS_ENV]: "antigravity-cli" }
    });
  });

  test("isOurMcpEntry recognises our wrapper and upstream's own entry, nothing else", () => {
    expect(isOurMcpEntry(mcpServerEntry("/pkg"))).toBe(true);
    expect(
      isOurMcpEntry({
        command: "node",
        args: ["/usr/lib/node_modules/@vectorize-io/hindsight-coding-agents/dist/mcp-server.js"]
      })
    ).toBe(true);

    expect(isOurMcpEntry(FOREIGN_MCP)).toBe(false);
    expect(isOurMcpEntry({ command: "node", args: ["/opt/other/mcp-server.js"] })).toBe(false);
    expect(isOurMcpEntry({ command: "node" })).toBe(false);
    expect(isOurMcpEntry(null)).toBe(false);
    expect(isOurMcpEntry("node bin/mcp-server.js")).toBe(false);
  });
});

describe("install", () => {
  test("writes all four artefacts into the host's config tree", () => {
    const result = install(ctx());

    expect(result).toEqual({
      hooksPath: hooksPath(),
      mcpPath: mcpPath(),
      settingsPath: settingsPath(),
      skillDir: skillDir(),
      statusLine: "installed",
      mcp: "installed",
      skill: "installed"
    });
    for (const path of [hooksPath(), mcpPath(), settingsPath()]) {
      expect(existsSync(path)).toBe(true);
    }
  });

  test("merges one hook entry per wired event, under the shared marker key", () => {
    install(ctx());
    const group = hookGroup();

    for (const wiring of HOOK_WIRING) {
      const entries = entriesAt(group, wiring.event);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(hookEntry(pkgRoot, wiring));
      expect(entries[0]?.command).toBe(`node "${join(pkgRoot, "bin", wiring.bin)}"`);
      expect(entries[0]?.timeout).toBe(30);
    }
    expect(Object.keys(group).sort()).toEqual(HOOK_WIRING.map((w) => w.event).sort());
  });

  test("registers the MCP server with the harness marker in its environment", () => {
    install(ctx());

    const servers = readJsonFile(mcpPath()).mcpServers as Record<string, unknown>;
    expect(servers[MCP_SERVER_NAME]).toEqual(mcpServerEntry(pkgRoot));
    expect(isOurMcpEntry(servers[MCP_SERVER_NAME])).toBe(true);
  });

  test("enables the Hindsight status line", () => {
    install(ctx());

    const statusLine = readJsonFile(settingsPath()).statusLine as Record<string, unknown>;
    expect(statusLine.type).toBe("command");
    expect(statusLine.command).toBe(`node "${join(pkgRoot, "bin", "statusline.js")}"`);
  });

  test("copies the bundled skill into the host's skills directory", () => {
    const result = install(ctx());

    expect(result.skill).toBe("installed");
    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf8")).toBe("# Hindsight\n");
  });

  test("reports a skipped skill when the package bundles none", () => {
    rmSync(join(pkgRoot, "skills"), { recursive: true, force: true });

    const result = install(ctx());

    expect(result.skill).toBe("skipped");
    expect(existsSync(skillDir())).toBe(false);
  });

  test("writes 2-space JSON with a trailing newline", () => {
    install(ctx());

    for (const path of [hooksPath(), mcpPath(), settingsPath()]) {
      const text = readFileSync(path, "utf8");
      expect(text.endsWith("\n")).toBe(true);
      expect(text).toBe(`${JSON.stringify(JSON.parse(text) as unknown, null, 2)}\n`);
    }
  });

  test("is idempotent: a second install replaces its own entries instead of doubling them", () => {
    install(ctx());
    const first = readFileSync(hooksPath(), "utf8");
    install(ctx());

    const hooks = readJsonFile(hooksPath());
    expect(Object.keys(hooks).filter((key) => key.includes(HOOK_MARKER))).toEqual([HOOK_MARKER]);
    for (const wiring of HOOK_WIRING) {
      expect(entriesAt(hookGroup(), wiring.event)).toHaveLength(1);
    }
    expect(readFileSync(hooksPath(), "utf8")).toBe(first);
  });

  test("strips a stale copy of our own hook from the top-level event arrays", () => {
    seed(hooksPath(), {
      PreInvocation: [
        FOREIGN_HOOK,
        { command: 'node "/old/install/bin/pre-invocation.js"', timeout: 30 }
      ]
    });

    install(ctx());

    // Left behind, the hook would run twice per invocation.
    const topLevel = entriesAt(readJsonFile(hooksPath()), "PreInvocation");
    expect(topLevel).toEqual([FOREIGN_HOOK]);
    expect(entriesAt(hookGroup(), "PreInvocation")).toHaveLength(1);
  });

  test("leaves another tool's hooks untouched", () => {
    seed(hooksPath(), {
      "other-tool": { PreInvocation: [FOREIGN_HOOK] },
      PreInvocation: [FOREIGN_HOOK],
      Stop: [FOREIGN_HOOK]
    });

    install(ctx());

    const hooks = readJsonFile(hooksPath());
    expect(hooks["other-tool"]).toEqual({ PreInvocation: [FOREIGN_HOOK] });
    expect(entriesAt(hooks, "PreInvocation")).toEqual([FOREIGN_HOOK]);
    expect(entriesAt(hooks, "Stop")).toEqual([FOREIGN_HOOK]);
  });

  test("preserves a foreign MCP server registered under the hindsight name", () => {
    seed(mcpPath(), { mcpServers: { [MCP_SERVER_NAME]: FOREIGN_MCP, other: FOREIGN_MCP } });

    const result = install(ctx());

    expect(result.mcp).toBe("preserved");
    const servers = readJsonFile(mcpPath()).mcpServers as Record<string, unknown>;
    expect(servers[MCP_SERVER_NAME]).toEqual(FOREIGN_MCP);
    expect(servers.other).toEqual(FOREIGN_MCP);
    expect(logged.join("\n")).toContain("preserved");
  });

  test("upgrades an entry written by upstream's own installer in place", () => {
    const upstream = {
      command: "node",
      args: ["/usr/lib/node_modules/@vectorize-io/hindsight-coding-agents/dist/mcp-server.js"],
      env: { [MCP_HARNESS_ENV]: "antigravity-cli" }
    };
    seed(mcpPath(), { mcpServers: { [MCP_SERVER_NAME]: upstream, other: FOREIGN_MCP } });

    const result = install(ctx());

    expect(result.mcp).toBe("installed");
    const servers = readJsonFile(mcpPath()).mcpServers as Record<string, unknown>;
    expect(servers[MCP_SERVER_NAME]).toEqual(mcpServerEntry(pkgRoot));
    expect(servers.other).toEqual(FOREIGN_MCP);
  });

  test("preserves an unrelated custom status line", () => {
    seed(settingsPath(), { statusLine: FOREIGN_STATUS_LINE, theme: "dark" });

    const result = install(ctx());

    expect(result.statusLine).toBe("preserved");
    const settings = readJsonFile(settingsPath());
    expect(settings.statusLine).toEqual(FOREIGN_STATUS_LINE);
    expect(settings.theme).toBe("dark");
    expect(logged.join("\n")).toContain("preserved");
  });

  test("rewrites a status line that is already ours", () => {
    install(ctx());
    const result = install(ctx());

    expect(result.statusLine).toBe("installed");
    const statusLine = readJsonFile(settingsPath()).statusLine as Record<string, unknown>;
    expect(statusLine.command).toBe(`node "${join(pkgRoot, "bin", "statusline.js")}"`);
  });

  test("backs each touched file up once, keeping the user's original", () => {
    const originals = {
      [hooksPath()]: seed(hooksPath(), { PreInvocation: [FOREIGN_HOOK] }),
      [mcpPath()]: seed(mcpPath(), { mcpServers: { other: FOREIGN_MCP } }),
      [settingsPath()]: seed(settingsPath(), { theme: "dark" })
    };

    install(ctx());
    install(ctx());

    for (const [path, original] of Object.entries(originals)) {
      // A second backup would replace the user's file with our own earlier output.
      expect(readFileSync(`${path}.hindsight-backup`, "utf8")).toBe(original);
    }
  });

  test("takes no backup of a file it created itself", () => {
    install(ctx());

    for (const path of [hooksPath(), mcpPath(), settingsPath()]) {
      expect(existsSync(`${path}.hindsight-backup`)).toBe(false);
    }
  });
});

describe("uninstall", () => {
  test("removes exactly what install added", () => {
    install(ctx());
    const result = uninstall(ctx());

    expect(result).toEqual({
      hooksPath: hooksPath(),
      mcpPath: mcpPath(),
      settingsPath: settingsPath(),
      skillDir: skillDir()
    });

    const hooks = readJsonFile(hooksPath());
    expect(hooks[HOOK_MARKER]).toBeUndefined();
    for (const wiring of HOOK_WIRING) expect(hooks[wiring.event]).toBeUndefined();

    const servers = readJsonFile(mcpPath()).mcpServers as Record<string, unknown>;
    expect(servers[MCP_SERVER_NAME]).toBeUndefined();

    expect(readJsonFile(settingsPath()).statusLine).toBeUndefined();
    expect(existsSync(skillDir())).toBe(false);
  });

  test("leaves every foreign entry alone", () => {
    seed(hooksPath(), {
      "other-tool": { PreInvocation: [FOREIGN_HOOK] },
      PreInvocation: [FOREIGN_HOOK]
    });
    seed(mcpPath(), { mcpServers: { other: FOREIGN_MCP } });
    seed(settingsPath(), { theme: "dark" });

    install(ctx());
    uninstall(ctx());

    const hooks = readJsonFile(hooksPath());
    expect(hooks["other-tool"]).toEqual({ PreInvocation: [FOREIGN_HOOK] });
    expect(entriesAt(hooks, "PreInvocation")).toEqual([FOREIGN_HOOK]);
    expect((readJsonFile(mcpPath()).mcpServers as Record<string, unknown>).other).toEqual(
      FOREIGN_MCP
    );
    expect(readJsonFile(settingsPath()).theme).toBe("dark");
  });

  test("never removes a foreign hindsight MCP server or a foreign status line", () => {
    seed(mcpPath(), { mcpServers: { [MCP_SERVER_NAME]: FOREIGN_MCP } });
    seed(settingsPath(), { statusLine: FOREIGN_STATUS_LINE });

    install(ctx());
    uninstall(ctx());

    const servers = readJsonFile(mcpPath()).mcpServers as Record<string, unknown>;
    expect(servers[MCP_SERVER_NAME]).toEqual(FOREIGN_MCP);
    expect(readJsonFile(settingsPath()).statusLine).toEqual(FOREIGN_STATUS_LINE);
  });

  test("is safe to run twice, and on a machine that was never installed", () => {
    expect(() => uninstall(ctx())).not.toThrow();

    install(ctx());
    uninstall(ctx());

    expect(() => uninstall(ctx())).not.toThrow();
    expect(existsSync(skillDir())).toBe(false);
  });
});
