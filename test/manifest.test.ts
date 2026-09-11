import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  HARNESS,
  HOOK_MARKER,
  HOOK_WIRING,
  MCP_HARNESS_ENV,
  MCP_SERVER_NAME,
  RUNTIME_PACKAGE,
  SKILL_NAME
} from "../src/harness.js";

const repoRoot = join(import.meta.dir, "..");

/** The placeholder Antigravity expands to the installed plugin's directory. */
const PLUGIN_ROOT = "${PLUGIN_ROOT}";

function readJson(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, name), "utf8"));
  expect(parsed).toBeObject();
  return parsed as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeObject();
  return value as Record<string, unknown>;
}

/** The MCP registration both `mcp_config.json` and `plugin.json` are expected to declare. */
const EXPECTED_MCP_ENTRY = {
  command: "node",
  args: [`${PLUGIN_ROOT}/bin/mcp-server.js`],
  env: { [MCP_HARNESS_ENV]: HARNESS }
};

describe("hooks.json", () => {
  const hooks = readJson("hooks.json");

  test("groups every entry under the shared marker key and nothing else", () => {
    expect(Object.keys(hooks)).toEqual([HOOK_MARKER]);
    // A top-level event array alongside the group would run each hook twice.
    for (const wiring of HOOK_WIRING) expect(hooks[wiring.event]).toBeUndefined();
  });

  test("wires each event exactly once, at this package's wrapper", () => {
    const group = record(hooks[HOOK_MARKER]);
    expect(Object.keys(group).sort()).toEqual(HOOK_WIRING.map((w) => w.event).sort());

    for (const wiring of HOOK_WIRING) {
      const entries = group[wiring.event];
      expect(entries).toBeArray();
      expect(entries as unknown[]).toHaveLength(1);

      const entry = record((entries as unknown[])[0]);
      expect(entry.command).toBe(`node "${PLUGIN_ROOT}/bin/${wiring.bin}"`);
      expect(entry.timeout).toBe(wiring.timeout);
      expect(entry.timeout).toBe(30);
    }
  });

  test("every command is portable: no absolute or repo-relative path", () => {
    const text = readFileSync(join(repoRoot, "hooks.json"), "utf8");
    expect(text).toContain(PLUGIN_ROOT);
    expect(text).not.toContain("/home/");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain('"./bin/');
  });
});

describe("mcp_config.json", () => {
  test("registers the stdio server under the hindsight name, carrying the harness marker", () => {
    const servers = record(readJson("mcp_config.json").mcpServers);

    expect(Object.keys(servers)).toEqual([MCP_SERVER_NAME]);
    expect(servers[MCP_SERVER_NAME]).toEqual(EXPECTED_MCP_ENTRY);
  });
});

describe("plugin.json", () => {
  const plugin = readJson("plugin.json");

  test("points at the manifests and asset directories this package ships", () => {
    expect(plugin.name).toBe(MCP_SERVER_NAME);
    expect(plugin.hooks).toBe("./hooks.json");
    expect(plugin.skills).toBe("./skills");

    for (const key of ["hooks", "skills", "rules"]) {
      const reference = plugin[key];
      if (reference === undefined) continue;
      expect(reference).toBeString();
      expect(existsSync(join(repoRoot, reference as string))).toBe(true);
    }
  });

  test("declares the same MCP server as mcp_config.json", () => {
    const declared = plugin.mcpServers;
    if (typeof declared === "string") {
      // A file reference is equally valid, as long as it points at the manifest we checked.
      expect(declared).toContain("mcp_config.json");
      expect(existsSync(join(repoRoot, declared))).toBe(true);
      return;
    }
    expect(record(declared)[MCP_SERVER_NAME]).toEqual(EXPECTED_MCP_ENTRY);
  });

  test("ships the skill the installer copies", () => {
    const skill = join(repoRoot, "skills", SKILL_NAME);
    expect(statSync(skill).isDirectory()).toBe(true);
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
  });
});

describe("package.json", () => {
  const pkg = readJson("package.json");

  test("every bin entry exists on disk and is an executable wrapper", () => {
    const bins = record(pkg.bin);
    expect(Object.keys(bins).length).toBeGreaterThan(0);

    for (const [name, target] of Object.entries(bins)) {
      expect(target).toBeString();
      const path = join(repoRoot, target as string);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toStartWith("#!/usr/bin/env node");
      expect(name).toStartWith("hindsight-antigravity-");
    }
  });

  test("ships a bin for every wrapper the wiring names", () => {
    const targets = Object.values(record(pkg.bin)).map(String);
    const wrappers = [...HOOK_WIRING.map((w) => w.bin), "statusline.js", "mcp-server.js"];

    for (const wrapper of new Set(wrappers)) {
      expect(targets).toContain(`bin/${wrapper}`);
    }
  });

  test("files ships everything the plugin needs once installed", () => {
    const files = pkg.files;
    expect(files).toBeArray();

    for (const entry of ["dist", "bin", "skills", "plugin.json", "hooks.json", "mcp_config.json"]) {
      expect(files as string[]).toContain(entry);
      expect(existsSync(join(repoRoot, entry))).toBe(true);
    }
  });

  test("depends on the upstream runtime and no longer on the MCP SDK", () => {
    const dependencies = record(pkg.dependencies);
    const devDependencies = record(pkg.devDependencies);

    expect(dependencies[RUNTIME_PACKAGE]).toBeString();
    expect(dependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(devDependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
  });

  test("no manifest still advertises the deleted custom implementation", () => {
    for (const name of ["package.json", "plugin.json", "hooks.json", "mcp_config.json"]) {
      expect(readFileSync(join(repoRoot, name), "utf8")).not.toContain(
        "@modelcontextprotocol/sdk"
      );
    }
  });
});

describe("bin wrappers", () => {
  const tsup = readFileSync(join(repoRoot, "tsup.config.ts"), "utf8");

  test("import a build output the bundler actually produces", () => {
    const wrappers = ["pre-invocation.js", "stop-hook.js", "statusline.js", "mcp-server.js"];

    for (const wrapper of wrappers) {
      const source = readFileSync(join(repoRoot, "bin", wrapper), "utf8");
      const match = /from\s+"\.\.\/dist\/([\w.-]+)\.js"/.exec(source);
      expect(match).not.toBeNull();

      const entry = match?.[1] as string;
      expect(source).toContain(`../dist/${entry}.js`);
      // tsup names the entry as either `name: "src/..."` or `"name": "src/..."`.
      expect(tsup.includes(`${entry}:`) || tsup.includes(`"${entry}":`)).toBe(true);
    }
  });
});
