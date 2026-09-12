/**
 * How Hindsight is wired into the **Antigravity desktop application**.
 *
 * This plugin is for the Antigravity app — the thing a user launches and opens a workspace in, whose
 * own state lives in `~/.gemini/antigravity`. It is NOT for `agy`, the Antigravity CLI: that one is
 * already covered by `npx @vectorize-io/hindsight-coding-agents install agy`, which wires the same
 * runtime into a TUI with a status line, a `~/.gemini/antigravity-cli/settings.json` and a
 * `~/.gemini/antigravity-cli/plugins` staging directory. None of those exist for the app, so none of
 * them are touched here.
 *
 * Three host surfaces matter, and they are deliberately three different files:
 *
 * 1. **Hooks** — `~/.gemini/config/hooks.json`, the global hooks file Antigravity reads for all of
 *    its flavours (the app, the IDE and the CLI). This is where the recall and retain hooks go.
 * 2. **MCP** — `~/.gemini/antigravity/mcp_config.json`, the app's *own* MCP registry: the file its
 *    Settings → Customizations → "Open MCP Config" button opens. Antigravity 2.x additionally reads
 *    a shared `~/.gemini/config/mcp_config.json`; that one is opt-in here ({@link SHARED_MCP_CONFIG_PATH}).
 * 3. **Plugin bundle** — `~/.gemini/config/plugins/hindsight`, a namespaced plugin directory. The app
 *    discovers a plugin's `skills/` and `rules/` by convention, which is how the companion skill and
 *    the always-on memory rules reach it.
 *
 * The bundle deliberately carries NO `hooks.json` and NO `mcp_config.json`, even though the plugin
 * format allows both. Hooks and MCP are registered once, at host level, because a plugin-level copy
 * of either would be a *second* registration of the same command: two `PreInvocation` entries inject
 * memory twice and retain the turn twice. Declarative content (skills, rules) is idempotent and so
 * lives in the bundle; anything that spawns a process does not.
 */

/** The host: the Antigravity desktop application. Used in log lines and diagnostics. */
export const HOST = "antigravity";

/**
 * The harness id the *runtime* stamps on everything it retains — not a statement about which
 * Antigravity surface is running.
 *
 * `@vectorize-io/hindsight-coding-agents` calls its Antigravity integration `antigravity-cli` and
 * hardcodes that string inside `dist/antigravity-hook.js` and `dist/antigravity-stop-hook.js`
 * (`runHarnessPrompt("antigravity-cli")`). The hook entry points take no harness argument, so this
 * value cannot be changed from the outside — and it must not be worked around, because the id
 * selects the `harnesses.<id>` config section and feeds `{harness}` in `bankIdTemplate`. Setting
 * `HINDSIGHT_MCP_HARNESS` to anything else would point the `hindsight_*` tools at a different
 * config section, and potentially a different memory bank, than the hooks use.
 *
 * The app and the CLI speak the same hook protocol — the same `hooks.json` shape, the same
 * `PreInvocation`/`Stop` events, the same `workspacePaths`/`conversationId`/`transcriptPath`
 * payload — so one runtime harness correctly serves both. Only the *installation* differs, and that
 * is what the rest of this file describes.
 */
export const RUNTIME_HARNESS = "antigravity-cli";

/** The upstream package that provides the memory runtime. This plugin never reimplements it. */
export const RUNTIME_PACKAGE = "@vectorize-io/hindsight-coding-agents";

/**
 * The hook name our entries are grouped under in `hooks.json`. Antigravity's hooks file maps a hook
 * name to its events, so this is a key, not a marker comment — but it doubles as one: upstream's own
 * installer groups under the same name, so an install from either side replaces the other's entries
 * rather than adding a second copy of the same command.
 */
export const HOOK_NAME = "coding-agents";

/** Directory name of the plugin bundle, inside Antigravity's plugins root. */
export const PLUGIN_NAME = "hindsight";

/** Directory name of the companion skill, inside the bundle's `skills/`. */
export const SKILL_NAME = "hindsight-coding-agent";

/** Name the stdio MCP server registers under in the app's `mcp_config.json`. */
export const MCP_SERVER_NAME = "hindsight";

/** Env var the runtime's MCP server reads to know which harness is asking. */
export const MCP_HARNESS_ENV = "HINDSIGHT_MCP_HARNESS";

/**
 * Bundled runtime entry points this plugin delegates to.
 *
 * `antigravity-statusline.js` is deliberately absent: the status line is a feature of the CLI's TUI,
 * rendered from `~/.gemini/antigravity-cli/settings.json`. The desktop app draws its own chrome and
 * has nothing to render a command's stdout into, so shipping a status-line wrapper for it would be
 * wiring with no socket to plug into.
 */
export type RuntimeEntry = "antigravity-hook.js" | "antigravity-stop-hook.js" | "mcp-server.js";

/** Executable wrappers this package ships, one per runtime entry point. */
export type PluginBin = "pre-invocation.js" | "stop-hook.js" | "mcp-server.js";

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

/**
 * Global hooks file, read by every Antigravity flavour including the app.
 *
 * Note `config/`, not `antigravity/`: hooks are host-wide, not per-product. The app has no hooks
 * file of its own.
 */
export const HOOKS_CONFIG_PATH = [".gemini", "config", "hooks.json"] as const;

/**
 * The desktop app's own MCP registry — the file behind its "Open MCP Config" button, and the one
 * every Antigravity app setup guide names. This is the primary MCP target.
 */
export const APP_MCP_CONFIG_PATH = [".gemini", "antigravity", "mcp_config.json"] as const;

/**
 * The shared MCP registry Antigravity 2.x reads across the app, the IDE, the CLI and the SDK.
 *
 * Opt-in (`--shared-mcp`), never written by default: on a 2.x install the app reads both this file
 * and {@link APP_MCP_CONFIG_PATH}, and registering `hindsight` in both is how you end up with the
 * server listed twice. Uninstall cleans both regardless, so a user who opted in once is not left
 * with a stale entry.
 */
export const SHARED_MCP_CONFIG_PATH = [".gemini", "config", "mcp_config.json"] as const;

/** The plugin bundle's directory: Antigravity's global plugins root, namespaced by plugin name. */
export const PLUGIN_DIR = [".gemini", "config", "plugins", PLUGIN_NAME] as const;
