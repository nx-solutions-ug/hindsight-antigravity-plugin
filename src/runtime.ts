/**
 * Locating and running the Hindsight coding-agent runtime.
 *
 * The plugin owns no memory logic of its own: each hook wrapper resolves the matching entry point
 * inside `@vectorize-io/hindsight-coding-agents` and hands the process over to it. Resolution goes
 * through Node's own resolver so the runtime is found wherever the package manager put it —
 * alongside this package, hoisted to a workspace root, or in a global install.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNTIME_PACKAGE, type RuntimeEntry } from "./harness.js";

const require = createRequire(import.meta.url);

/** Raised when the runtime package cannot be resolved — a broken or partial install. */
export class RuntimeUnavailableError extends Error {
  readonly entry: RuntimeEntry;

  constructor(entry: RuntimeEntry, options?: { cause?: unknown }) {
    super(
      `Hindsight runtime not available: could not resolve ${RUNTIME_PACKAGE}/dist/${entry}. ` +
        `Reinstall the plugin so its dependencies are present.`,
      options
    );
    this.name = "RuntimeUnavailableError";
    this.entry = entry;
  }
}

/** Absolute path of the installed runtime package's root directory. */
export function runtimeRoot(): string {
  try {
    return dirname(require.resolve(`${RUNTIME_PACKAGE}/package.json`));
  } catch (cause) {
    throw new RuntimeUnavailableError("mcp-server.js", { cause });
  }
}

/** Absolute path of the runtime's `dist` directory, where every entry point lives. */
export function runtimeDist(): string {
  return join(runtimeRoot(), "dist");
}

/** Absolute path of one runtime entry point. Throws {@link RuntimeUnavailableError} if missing. */
export function resolveRuntimeEntry(entry: RuntimeEntry): string {
  try {
    return require.resolve(`${RUNTIME_PACKAGE}/dist/${entry}`);
  } catch (cause) {
    throw new RuntimeUnavailableError(entry, { cause });
  }
}

/** Version of the runtime this plugin is running against, or `undefined` if it cannot be read. */
export function runtimeVersion(): string | undefined {
  try {
    const pkg = require(`${RUNTIME_PACKAGE}/package.json`) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run a runtime entry point in this process.
 *
 * The entry points are self-driving scripts: they read the host's JSON payload from stdin and write
 * their reply to stdout. Importing one is therefore the whole of running it, and keeping it
 * in-process avoids a second Node startup inside a hook budget measured in seconds.
 *
 * Two of them start themselves only when `process.argv[1]` is their own file — `mcp-server.js`
 * compares it against its own path, `antigravity-statusline.js` against its name — so that
 * importing them as a library does not spawn a server. A wrapper that left its own path there
 * would load those modules and run nothing at all. Standing in as the script the host spawned is
 * the honest description of what these wrappers are, so argv says so for the duration of the call
 * and is put back afterwards.
 */
export async function runRuntimeEntry(entry: RuntimeEntry): Promise<void> {
  const entryPath = resolveRuntimeEntry(entry);
  const spawnedAs = process.argv[1];
  process.argv[1] = entryPath;
  try {
    await import(pathToFileURL(entryPath).href);
  } finally {
    if (spawnedAs === undefined) process.argv.splice(1, 1);
    else process.argv[1] = spawnedAs;
  }
}
