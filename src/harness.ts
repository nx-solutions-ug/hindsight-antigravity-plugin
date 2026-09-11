/**
 * How Hindsight's coding-agent runtime is wired into Antigravity.
 *
 * Every constant here mirrors `@vectorize-io/hindsight-coding-agents`' own
 * `antigravity-cli` harness definition — the hook events it wires, the config files it writes, the
 * marker it groups its entries under. This plugin ships the same wiring as an Antigravity plugin
 * instead of an installer target, so the two must agree: a session wired by either route has to
 * behave identically, share the same bank and be uninstallable by either side.
 */

/** The harness name the runtime stamps on everything it retains, and reports in diagnostics. */
export const HARNESS = "antigravity-cli";

/** The upstream package that provides the memory runtime. This plugin never reimplements it. */
export const RUNTIME_PACKAGE = "@vectorize-io/hindsight-coding-agents";

/**
 * The key every hook entry is grouped under in `~/.gemini/config/hooks.json`, and the substring the
 * installer matches on to find its own entries again. Upstream uses the same marker, so an install
 * from either side replaces the other's entries rather than doubling them.
 */
export const HOOK_MARKER = "coding-agents";

/** Directory name of the companion skill, inside the host's skills root. */
export const SKILL_NAME = "hindsight-coding-agent";

/** Name the stdio MCP server registers under in `~/.gemini/config/mcp_config.json`. */
export const MCP_SERVER_NAME = "hindsight";

/** Env var the runtime's MCP server reads to know which harness is asking. */
export const MCP_HARNESS_ENV = "HINDSIGHT_MCP_HARNESS";

/** Bundled runtime entry points this plugin delegates to. */
export type RuntimeEntry =
  | "antigravity-hook.js"
  | "antigravity-stop-hook.js"
  | "antigravity-statusline.js"
  | "mcp-server.js";

/** Executable wrappers this package ships, one per runtime entry point. */
export type PluginBin =
  | "pre-invocation.js"
  | "stop-hook.js"
  | "statusline.js"
  | "mcp-server.js";

export interface HookWiring {
  /** Antigravity lifecycle event. */
  readonly event: "PreInvocation" | "Stop";
  /** Runtime entry point the wrapper delegates to. */
  readonly entry: RuntimeEntry;
  /** Wrapper in this package's `bin/` that the host actually spawns. */
  readonly bin: PluginBin;
  /** Host timeout, in seconds — Antigravity's unit. */
  readonly timeout: number;
}

/**
 * `PreInvocation` is Antigravity's only lifecycle point that can inject context, so it carries the
 * session-start work too: the runtime's own seed guard makes the first invocation of a session do
 * what other harnesses do in `SessionStart`.
 */
export const HOOK_WIRING: readonly HookWiring[] = [
  {
    event: "PreInvocation",
    entry: "antigravity-hook.js",
    bin: "pre-invocation.js",
    timeout: 30
  },
  {
    event: "Stop",
    entry: "antigravity-stop-hook.js",
    bin: "stop-hook.js",
    timeout: 30
  }
];

/** Host config files, relative to the user's home directory. */
export const HOOKS_CONFIG_PATH = [".gemini", "config", "hooks.json"] as const;
export const MCP_CONFIG_PATH = [".gemini", "config", "mcp_config.json"] as const;
export const SETTINGS_PATH = [".gemini", HARNESS, "settings.json"] as const;
export const SKILLS_DIR = [".gemini", "config", "skills"] as const;
