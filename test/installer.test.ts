import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  APP_MCP_CONFIG_PATH,
  HOOKS_CONFIG_PATH,
  HOOK_NAME,
  HOOK_WIRING,
  MCP_HARNESS_ENV,
  MCP_SERVER_NAME,
  PLUGIN_DIR,
  PLUGIN_NAME,
  SHARED_MCP_CONFIG_PATH,
  SKILL_NAME
} from "../src/host.js";
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

const PKG_VERSION = "9.9.9";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hindsight-home-"));
  pkgRoot = mkdtempSync(join(tmpdir(), "hindsight-pkg-"));
  logged = [];

  // A plausible package layout: the wrappers the host spawns, the manifest template, and the
  // declarative assets the bundle carries.
  mkdirSync(join(pkgRoot, "bin"), { recursive: true });
  for (const bin of ["pre-invocation.js", "stop-hook.js", "mcp-server.js"]) {
    writeFileSync(join(pkgRoot, "bin", bin), "#!/usr/bin/env node\n");
  }
  mkdirSync(join(pkgRoot, "skills", SKILL_NAME), { recursive: true });
  writeFileSync(join(pkgRoot, "skills", SKILL_NAME, "SKILL.md"), "# Hindsight\n");
  mkdirSync(join(pkgRoot, "rules"), { recursive: true });
  writeFileSync(join(pkgRoot, "rules", "AGENTS.md"), "# Memory rules\n");
  writeFileSync(
    join(pkgRoot, "plugin.json"),
    `${JSON.stringify({ name: PLUGIN_NAME, description: "memory" }, null, 2)}\n`
  );
  writeFileSync(
    join(pkgRoot, "package.json"),
    `${JSON.stringify({ name: "@chronova/x", version: PKG_VERSION }, null, 2)}\n`
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(pkgRoot, { recursive: true, force: true });
});

const ctx = (extra: InstallContext = {}): InstallContext => ({
  home,
  pkgRoot,
  log: (message) => void logged.push(message),
  ...extra
});

const hooksPath = (): string => join(home, ...HOOKS_CONFIG_PATH);
const appMcpPath = (): string => join(home, ...APP_MCP_CONFIG_PATH);
const sharedMcpPath = (): string => join(home, ...SHARED_MCP_CONFIG_PATH);
const pluginDir = (): string => join(home, ...PLUGIN_DIR);
const skillDir = (): string => join(pluginDir(), "skills", SKILL_NAME);
const rulesDir = (): string => join(pluginDir(), "rules");

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

/** The object under `hooks.json`'s hook name, which is where our entries live. */
function hookGroup(): Record<string, unknown> {
  const group = readJsonFile(hooksPath())[HOOK_NAME];
  expect(group).toBeObject();
  return group as Record<string, unknown>;
}

function entriesAt(container: Record<string, unknown>, event: string): Record<string, unknown>[] {
  const value = container[event];
  if (value === undefined) return [];
  expect(value).toBeArray();
  return value as Record<string, unknown>[];
}

function servers(path: string): Record<string, unknown> {
  const value = readJsonFile(path).mcpServers;
  expect(value).toBeObject();
  return value as Record<string, unknown>;
}

const FOREIGN_HOOK = { command: "node /opt/other-tool/pre.js", timeout: 5 };
const FOREIGN_MCP = { command: "npx", args: ["-y", "some-other-hindsight"] };

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

  test("mcpServerEntry spawns our wrapper and names the runtime's harness", () => {
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
  test("reports every path it wrote, and writes the app's MCP registry by default", () => {
    const result = install(ctx());

    expect(result).toEqual({
      hooksPath: hooksPath(),
      appMcpPath: appMcpPath(),
      sharedMcpPath: sharedMcpPath(),
      pluginDir: pluginDir(),
      skillDir: skillDir(),
      rulesDir: rulesDir(),
      appMcp: "installed",
      sharedMcp: "skipped",
      skill: "installed",
      rules: "installed"
    });
    for (const path of [hooksPath(), appMcpPath()]) expect(existsSync(path)).toBe(true);
  });

  test("registers the MCP server in the desktop app's own config directory", () => {
    install(ctx());

    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toEqual(mcpServerEntry(pkgRoot));
    // The shared 2.x registry is opt-in: writing both would list the server twice.
    expect(existsSync(sharedMcpPath())).toBe(false);
  });

  test("writes the shared 2.x registry only when asked", () => {
    const result = install(ctx({ sharedMcp: true }));

    expect(result.sharedMcp).toBe("installed");
    expect(servers(sharedMcpPath())[MCP_SERVER_NAME]).toEqual(mcpServerEntry(pkgRoot));
    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toEqual(mcpServerEntry(pkgRoot));
  });

  test("never writes anything into the Antigravity CLI's tree", () => {
    install(ctx({ sharedMcp: true }));

    expect(existsSync(join(home, ".gemini", "antigravity-cli"))).toBe(false);
  });

  test("merges one hook entry per wired event, under the shared hook name", () => {
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

  test("writes absolute commands: Antigravity expands no placeholder in these files", () => {
    install(ctx());

    const text = readFileSync(hooksPath(), "utf8") + readFileSync(appMcpPath(), "utf8");
    expect(text).not.toContain("${");
    for (const wiring of HOOK_WIRING) {
      expect(text).toContain(join(pkgRoot, "bin", wiring.bin));
    }
  });
});

describe("the plugin bundle", () => {
  test("carries the manifest, the skill and the rules", () => {
    install(ctx());

    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf8")).toBe("# Hindsight\n");
    expect(readFileSync(join(rulesDir(), "AGENTS.md"), "utf8")).toBe("# Memory rules\n");

    const manifest = readJsonFile(join(pluginDir(), "plugin.json"));
    expect(manifest.name).toBe(PLUGIN_NAME);
    expect(manifest.description).toBe("memory");
  });

  test("stamps the installed package's version, so the two manifests cannot drift", () => {
    install(ctx());

    expect(readJsonFile(join(pluginDir(), "plugin.json")).version).toBe(PKG_VERSION);
    // The template deliberately carries none — the version has one source of truth.
    expect(readJsonFile(join(pkgRoot, "plugin.json")).version).toBeUndefined();
  });

  test("carries no hooks.json or mcp_config.json: either would be a second registration", () => {
    install(ctx());

    expect(existsSync(join(pluginDir(), "hooks.json"))).toBe(false);
    expect(existsSync(join(pluginDir(), "mcp_config.json"))).toBe(false);
  });

  test("replaces a stale copy of an asset rather than merging into it", () => {
    install(ctx());
    writeFileSync(join(skillDir(), "GONE.md"), "removed upstream\n");

    install(ctx());

    expect(existsSync(join(skillDir(), "GONE.md"))).toBe(false);
    expect(existsSync(join(skillDir(), "SKILL.md"))).toBe(true);
  });

  test("reports skipped assets when the package bundles none", () => {
    rmSync(join(pkgRoot, "skills"), { recursive: true, force: true });
    rmSync(join(pkgRoot, "rules"), { recursive: true, force: true });

    const result = install(ctx());

    expect(result.skill).toBe("skipped");
    expect(result.rules).toBe("skipped");
    expect(existsSync(skillDir())).toBe(false);
    expect(existsSync(rulesDir())).toBe(false);
    // The manifest still goes out: the bundle is what makes the plugin discoverable.
    expect(existsSync(join(pluginDir(), "plugin.json"))).toBe(true);
  });
});

describe("install: living alongside what is already there", () => {
  test("writes 2-space JSON with a trailing newline", () => {
    install(ctx({ sharedMcp: true }));

    for (const path of [hooksPath(), appMcpPath(), sharedMcpPath()]) {
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
    expect(Object.keys(hooks).filter((key) => key.includes(HOOK_NAME))).toEqual([HOOK_NAME]);
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
    seed(appMcpPath(), { mcpServers: { [MCP_SERVER_NAME]: FOREIGN_MCP, other: FOREIGN_MCP } });

    const result = install(ctx());

    expect(result.appMcp).toBe("preserved");
    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toEqual(FOREIGN_MCP);
    expect(servers(appMcpPath()).other).toEqual(FOREIGN_MCP);
    expect(logged.join("\n")).toContain("preserved");
  });

  test("upgrades an entry written by upstream's own installer in place", () => {
    const upstream = {
      command: "node",
      args: ["/usr/lib/node_modules/@vectorize-io/hindsight-coding-agents/dist/mcp-server.js"],
      env: { [MCP_HARNESS_ENV]: "antigravity-cli" }
    };
    seed(appMcpPath(), { mcpServers: { [MCP_SERVER_NAME]: upstream, other: FOREIGN_MCP } });

    const result = install(ctx());

    expect(result.appMcp).toBe("installed");
    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toEqual(mcpServerEntry(pkgRoot));
    expect(servers(appMcpPath()).other).toEqual(FOREIGN_MCP);
  });

  test("backs each touched file up once, keeping the user's original", () => {
    const originals = {
      [hooksPath()]: seed(hooksPath(), { PreInvocation: [FOREIGN_HOOK] }),
      [appMcpPath()]: seed(appMcpPath(), { mcpServers: { other: FOREIGN_MCP } })
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

    for (const path of [hooksPath(), appMcpPath()]) {
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
      appMcpPath: appMcpPath(),
      sharedMcpPath: sharedMcpPath(),
      pluginDir: pluginDir(),
      pluginRemoved: true
    });

    const hooks = readJsonFile(hooksPath());
    expect(hooks[HOOK_NAME]).toBeUndefined();
    for (const wiring of HOOK_WIRING) expect(hooks[wiring.event]).toBeUndefined();

    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toBeUndefined();
    expect(existsSync(pluginDir())).toBe(false);
  });

  test("cleans the shared registry too, however this machine was installed", () => {
    // A user who once passed --shared-mcp must not be left pointing at a plugin that is gone.
    install(ctx({ sharedMcp: true }));
    uninstall(ctx());

    expect(servers(sharedMcpPath())[MCP_SERVER_NAME]).toBeUndefined();
    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toBeUndefined();
  });

  test("leaves every foreign entry alone", () => {
    seed(hooksPath(), {
      "other-tool": { PreInvocation: [FOREIGN_HOOK] },
      PreInvocation: [FOREIGN_HOOK]
    });
    seed(appMcpPath(), { mcpServers: { other: FOREIGN_MCP } });

    install(ctx());
    uninstall(ctx());

    const hooks = readJsonFile(hooksPath());
    expect(hooks["other-tool"]).toEqual({ PreInvocation: [FOREIGN_HOOK] });
    expect(entriesAt(hooks, "PreInvocation")).toEqual([FOREIGN_HOOK]);
    expect(servers(appMcpPath()).other).toEqual(FOREIGN_MCP);
  });

  test("never removes a foreign hindsight MCP server", () => {
    seed(appMcpPath(), { mcpServers: { [MCP_SERVER_NAME]: FOREIGN_MCP } });

    install(ctx());
    uninstall(ctx());

    expect(servers(appMcpPath())[MCP_SERVER_NAME]).toEqual(FOREIGN_MCP);
  });

  test("keeps a plugin directory that is not ours", () => {
    seed(join(pluginDir(), "plugin.json"), { name: "someone-elses-hindsight" });

    const result = uninstall(ctx());

    expect(result.pluginRemoved).toBe(false);
    expect(existsSync(join(pluginDir(), "plugin.json"))).toBe(true);
    expect(logged.join("\n")).toContain("not ours");
  });

  test("is safe to run twice, and on a machine that was never installed", () => {
    expect(() => uninstall(ctx())).not.toThrow();

    install(ctx());
    uninstall(ctx());

    expect(() => uninstall(ctx())).not.toThrow();
    expect(existsSync(pluginDir())).toBe(false);
  });
});
