import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  HOOK_WIRING,
  PLUGIN_NAME,
  RUNTIME_PACKAGE,
  SKILL_NAME
} from "../src/host.js";

const repoRoot = join(import.meta.dir, "..");

function readJson(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, name), "utf8"));
  expect(parsed).toBeObject();
  return parsed as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeObject();
  return value as Record<string, unknown>;
}

describe("plugin.json", () => {
  const plugin = readJson("plugin.json");

  test("is the Antigravity plugin manifest: a name and a description, nothing to expand", () => {
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(plugin.description).toBeString();
    expect(readFileSync(join(repoRoot, "plugin.json"), "utf8")).not.toContain("${");
  });

  test("carries no version — the installer stamps the package's own", () => {
    // Two hand-maintained versions is how plugin.json came to claim 1.0.0 in a 2.0.0 package.
    expect(plugin.version).toBeUndefined();
  });

  test("declares no components: Antigravity discovers them by directory convention", () => {
    for (const key of ["skills", "rules", "hooks", "mcpServers", "agents"]) {
      expect(plugin[key], key).toBeUndefined();
    }
  });
});

describe("the host wiring lives in the installer, not in shipped config files", () => {
  test("no hooks.json or mcp_config.json is shipped at the package root", () => {
    // Antigravity expands no placeholder in either file, so a shipped template could only ever be
    // wrong: commands have to be absolute, which means written at install time.
    for (const name of ["hooks.json", "mcp_config.json"]) {
      expect(existsSync(join(repoRoot, name)), name).toBe(false);
    }
  });
});

describe("bundled assets", () => {
  test("ship the skill the installer copies into the bundle", () => {
    const skill = join(repoRoot, "skills", SKILL_NAME);
    expect(statSync(skill).isDirectory()).toBe(true);
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
  });

  test("ship the always-on rules the installer copies into the bundle", () => {
    const rules = join(repoRoot, "rules");
    expect(statSync(rules).isDirectory()).toBe(true);
    expect(existsSync(join(rules, "AGENTS.md"))).toBe(true);
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

  test("ships a bin for every wrapper the wiring names, and the MCP server", () => {
    const targets = Object.values(record(pkg.bin)).map(String);

    for (const wrapper of new Set([...HOOK_WIRING.map((w) => w.bin), "mcp-server.js"])) {
      expect(targets).toContain(`bin/${wrapper}`);
    }
  });

  test("ships no status-line wrapper: that is the Antigravity CLI's TUI, not the app", () => {
    expect(Object.keys(record(pkg.bin)).join()).not.toContain("statusline");
    expect(existsSync(join(repoRoot, "bin", "statusline.js"))).toBe(false);
    expect(existsSync(join(repoRoot, "src", "statusline.ts"))).toBe(false);
  });

  test("files ships everything the installer reads once published", () => {
    const files = pkg.files;
    expect(files).toBeArray();

    // `dist` is a build output, so it is declared but not asserted on disk; the rest are checked
    // in, and the installer reads them out of the published package by these exact names.
    for (const entry of ["dist", "bin", "skills", "rules", "plugin.json"]) {
      expect(files as string[], entry).toContain(entry);
    }
    for (const entry of ["bin", "skills", "rules", "plugin.json"]) {
      expect(existsSync(join(repoRoot, entry)), entry).toBe(true);
    }
  });

  test("depends on the upstream runtime and no longer on the MCP SDK", () => {
    const dependencies = record(pkg.dependencies);
    const devDependencies = record(pkg.devDependencies);

    expect(dependencies[RUNTIME_PACKAGE]).toBeString();
    expect(dependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(devDependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
  });

  test("describes itself as the desktop app's plugin, not agy's", () => {
    const text = `${String(pkg.description)} ${(pkg.keywords as string[]).join(" ")}`;
    expect(text).toContain("antigravity");
    expect((pkg.keywords as string[])).not.toContain("agy");
  });
});

describe("bin wrappers", () => {
  const tsup = readFileSync(join(repoRoot, "tsup.config.ts"), "utf8");

  test("import a build output the bundler actually produces", () => {
    const wrappers = ["pre-invocation.js", "stop-hook.js", "mcp-server.js"];

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

  test("install.js imports only the installer bundle the build produces", () => {
    const source = readFileSync(join(repoRoot, "bin", "install.js"), "utf8");
    expect(source).toContain('from "../dist/installer.js"');
    expect(tsup).toContain("installer:");
  });
});
