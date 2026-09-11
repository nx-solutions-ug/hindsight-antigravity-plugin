import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { RUNTIME_PACKAGE, type RuntimeEntry } from "../src/harness.js";
import {
  RuntimeUnavailableError,
  resolveRuntimeEntry,
  runRuntimeEntry,
  runtimeDist,
  runtimeRoot,
  runtimeVersion
} from "../src/runtime.js";

const repoRoot = join(import.meta.dir, "..");

/** Every entry point the plugin delegates to. Nothing here is executed — only located. */
const ENTRIES: readonly RuntimeEntry[] = [
  "antigravity-hook.js",
  "antigravity-stop-hook.js",
  "antigravity-statusline.js",
  "mcp-server.js"
];

/**
 * The runtime is a real dependency, so these assertions describe a working install. In a tree where
 * it has not been installed yet the resolution tests are skipped rather than inverted: asserting
 * "resolution fails" would lock in the broken state as if it were the contract.
 */
const runtimeInstalled = (() => {
  try {
    runtimeRoot();
    return true;
  } catch {
    return false;
  }
})();

const whenInstalled = runtimeInstalled ? test : test.skip;

function declaredRuntimeRange(): string | undefined {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return pkg.dependencies?.[RUNTIME_PACKAGE];
}

/** Minimal `^`/`~`/exact range check — enough for a single pinned dependency, and offline. */
function satisfies(version: string, range: string): boolean {
  const parse = (value: string): number[] =>
    value
      .replace(/^[v^~>=<\s]+/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10));

  const [vMajor = 0, vMinor = 0, vPatch = 0] = parse(version);
  const [rMajor = 0, rMinor = 0, rPatch = 0] = parse(range);

  const atLeast =
    vMajor > rMajor ||
    (vMajor === rMajor && (vMinor > rMinor || (vMinor === rMinor && vPatch >= rPatch)));
  if (!atLeast) return false;

  if (range.startsWith("^")) {
    // npm caret: 0.x pins the minor, everything else pins the major.
    return rMajor === 0 ? vMajor === 0 && vMinor === rMinor : vMajor === rMajor;
  }
  if (range.startsWith("~")) return vMajor === rMajor && vMinor === rMinor;
  return vMajor === rMajor && vMinor === rMinor && vPatch === rPatch;
}

describe("Runtime resolution", () => {
  whenInstalled("runtimeRoot and runtimeDist point at the installed runtime package", () => {
    const root = runtimeRoot();
    expect(isAbsolute(root)).toBe(true);
    expect(statSync(root).isDirectory()).toBe(true);
    expect(root.replaceAll("\\", "/")).toContain("hindsight-coding-agents");

    const dist = runtimeDist();
    expect(dist).toBe(join(root, "dist"));
    expect(statSync(dist).isDirectory()).toBe(true);
  });

  for (const entry of ENTRIES) {
    whenInstalled(`resolveRuntimeEntry finds an existing file for ${entry}`, () => {
      const resolved = resolveRuntimeEntry(entry);
      expect(isAbsolute(resolved)).toBe(true);
      expect(existsSync(resolved)).toBe(true);
      expect(statSync(resolved).isFile()).toBe(true);
      expect(resolved.replaceAll("\\", "/").endsWith(`/dist/${entry}`)).toBe(true);
    });
  }

  whenInstalled("resolveRuntimeEntry returns a distinct path per entry", () => {
    const resolved = new Set(ENTRIES.map((entry) => resolveRuntimeEntry(entry)));
    expect(resolved.size).toBe(ENTRIES.length);
  });

  whenInstalled("runtimeVersion satisfies the range package.json declares", () => {
    const range = declaredRuntimeRange();
    expect(range).toBeDefined();

    const version = runtimeVersion();
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(satisfies(version as string, range as string)).toBe(true);
  });
});

describe("RuntimeUnavailableError", () => {
  test("names the entry it could not resolve", () => {
    const error = new RuntimeUnavailableError("antigravity-statusline.js");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RuntimeUnavailableError");
    expect(error.entry).toBe("antigravity-statusline.js");
    expect(error.message).toContain("antigravity-statusline.js");
    expect(error.message).toContain(RUNTIME_PACKAGE);
  });

  test("keeps the underlying resolution failure as its cause", () => {
    const cause = new Error("MODULE_NOT_FOUND");
    const error = new RuntimeUnavailableError("mcp-server.js", { cause });

    expect(error.cause).toBe(cause);
    expect(error.entry).toBe("mcp-server.js");
  });
});

/**
 * `mcp-server.js` self-starts only when `process.argv[1]` equals its own path and
 * `antigravity-statusline.js` only when `process.argv[1]` ends with its name, so `runRuntimeEntry`
 * stands in as the spawned script for the duration of the import. What must not leak is the
 * substitution itself: anything that reads `process.argv` afterwards — the runtime's own later
 * calls included — has to see what the host actually spawned.
 */
describe("runRuntimeEntry argv substitution", () => {
  /**
   * An inert module placed where the resolver looks, so the *resolving* path can be exercised
   * without importing (and thereby starting) a real entry point. Skipped if it cannot be created.
   */
  const probeName = "__hindsight-argv-probe.test.mjs";
  const probeEntry = probeName as RuntimeEntry;
  const probePath = runtimeInstalled ? join(runtimeDist(), probeName) : "";
  const probeGlobal = "__hindsightArgvProbe";

  const probeReady = (() => {
    if (!runtimeInstalled) return false;
    try {
      writeFileSync(
        probePath,
        `globalThis[${JSON.stringify(probeGlobal)}] = process.argv[1];\n`
      );
      return existsSync(resolveRuntimeEntry(probeEntry));
    } catch {
      return false;
    }
  })();

  const whenProbed = probeReady ? test : test.skip;

  afterAll(() => {
    if (probePath) rmSync(probePath, { force: true });
  });

  function observedArgv(): unknown {
    return (globalThis as Record<string, unknown>)[probeGlobal];
  }

  whenProbed("the imported module sees its own path as argv[1]", async () => {
    const spawnedAs = process.argv[1];

    await runRuntimeEntry(probeEntry);

    expect(observedArgv()).toBe(resolveRuntimeEntry(probeEntry));
    expect(process.argv[1]).toBe(spawnedAs);
  });

  whenProbed("argv[1] is restored after the entry resolves", async () => {
    const argvBefore = [...process.argv];

    await runRuntimeEntry(probeEntry);

    expect(process.argv).toEqual(argvBefore);
  });

  whenProbed("an absent argv[1] is spliced back out rather than left behind", async () => {
    const argvBefore = [...process.argv];
    process.argv.splice(1, process.argv.length - 1);
    try {
      await runRuntimeEntry(probeEntry);

      expect(process.argv.length).toBe(1);
      expect(process.argv[1]).toBeUndefined();
    } finally {
      process.argv.splice(0, process.argv.length, ...argvBefore);
    }
  });

  test("argv is untouched when the entry cannot be resolved", async () => {
    const argvBefore = [...process.argv];
    const missing = "no-such-entry.js" as RuntimeEntry;

    await expect(runRuntimeEntry(missing)).rejects.toBeInstanceOf(RuntimeUnavailableError);

    expect(process.argv).toEqual(argvBefore);
  });

  whenProbed("resolves mcp-server.js to the path its own self-start guard compares against", () => {
    const resolved = resolveRuntimeEntry("mcp-server.js");

    expect(existsSync(resolved)).toBe(true);
    expect(resolved.replaceAll("\\", "/").endsWith("/dist/mcp-server.js")).toBe(true);
    expect(resolved).toBe(join(runtimeDist(), "mcp-server.js"));
  });
});
