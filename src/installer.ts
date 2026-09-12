/**
 * Wiring this plugin into the Antigravity desktop application, and taking it back out again.
 *
 * Three targets, for the three reasons set out in `host.ts`:
 *
 * - `~/.gemini/config/hooks.json` — the recall and retain hooks, grouped under the `coding-agents`
 *   hook name that upstream's installer also uses, so the two routes replace rather than duplicate
 *   each other's entries.
 * - `~/.gemini/antigravity/mcp_config.json` — the app's own MCP registry, so the `hindsight_*` tools
 *   appear in the app's MCP server list. `--shared-mcp` additionally writes Antigravity 2.x's shared
 *   `~/.gemini/config/mcp_config.json`.
 * - `~/.gemini/config/plugins/hindsight/` — a namespaced plugin bundle carrying `plugin.json`, the
 *   companion skill and the always-on memory rules.
 *
 * Commands are written as absolute paths to this package's own `bin/` wrappers. Absolute, because
 * Antigravity does not expand path placeholders in these files — not `${workspaceFolder}`, and
 * nothing this plugin can rely on for a plugin root either — so a template would be spawned
 * verbatim and fail. This package's `bin/`, rather than the runtime's `dist/`, because the wrappers
 * add the fail-safe reply the host needs when memory is unreachable, and because their path stays
 * valid when the runtime is upgraded underneath them.
 *
 * Every file is backed up once before the first write, foreign entries are never touched, and
 * uninstall removes exactly what install added.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupOnce } from './config.js';
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
  SHARED_MCP_CONFIG_PATH,
  SKILL_NAME,
  type HookWiring,
  type PluginBin,
} from './host.js';

/**
 * Re-exported so `bin/install.js` needs exactly one built entry point: the seeding it does before
 * wiring reads and writes the same config file the installer reports on.
 */
export { configPath, describeServer, readConfig, writeConfig } from './config.js';

type JsonRecord = Record<string, unknown>;

export interface InstallContext {
  /** User's home directory. Defaults to `os.homedir()`; tests point it at a scratch directory. */
  home?: string;
  /** This package's root. Defaults to the directory containing `bin/`, `skills/` and `rules/`. */
  pkgRoot?: string;
  /**
   * Also register the MCP server in Antigravity 2.x's shared `~/.gemini/config/mcp_config.json`.
   * Off by default: on a host that reads both files, registering in both lists the server twice.
   */
  sharedMcp?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/** What happened to one `mcp_config.json`. `skipped` means we were not asked to write it. */
export type McpOutcome = 'installed' | 'preserved' | 'skipped';

export interface InstallResult {
  hooksPath: string;
  appMcpPath: string;
  sharedMcpPath: string;
  pluginDir: string;
  skillDir: string;
  rulesDir: string;
  /** The app's own registry — always written unless a foreign `hindsight` server holds the name. */
  appMcp: McpOutcome;
  /** Antigravity 2.x's shared registry — `skipped` unless `sharedMcp` was asked for. */
  sharedMcp: McpOutcome;
  skill: 'installed' | 'skipped';
  rules: 'installed' | 'skipped';
}

export interface UninstallResult {
  hooksPath: string;
  appMcpPath: string;
  sharedMcpPath: string;
  pluginDir: string;
  /** False when the plugin directory was left in place because it was not ours. */
  pluginRemoved: boolean;
}

/** Absolute path of one of this package's executable wrappers. */
export function binPath(pkgRoot: string, bin: PluginBin): string {
  return join(pkgRoot, 'bin', bin);
}

/** A hook entry in Antigravity's flat style: a command string plus a timeout in seconds. */
export function hookEntry(
  pkgRoot: string,
  wiring: HookWiring,
): { command: string; timeout?: number } {
  return {
    command: `node "${binPath(pkgRoot, wiring.bin)}"`,
    ...(wiring.timeout ? { timeout: wiring.timeout } : {}),
  };
}

/** The stdio MCP server Antigravity spawns for the `hindsight_*` tools. */
export function mcpServerEntry(pkgRoot: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: 'node',
    args: [binPath(pkgRoot, 'mcp-server.js')],
    env: { [MCP_HARNESS_ENV]: RUNTIME_HARNESS },
  };
}

/**
 * Is this MCP entry one we wrote?
 *
 * Both spellings count as ours: this package's `bin/mcp-server.js` wrapper, and the runtime's own
 * `dist/mcp-server.js` written by `npx @vectorize-io/hindsight-coding-agents install agy`. A user
 * who installed through upstream first should get their entry upgraded in place, not duplicated —
 * and anything else under the `hindsight` name is someone else's and must survive untouched.
 */
export function isOurMcpEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as { command?: unknown; args?: unknown };
  if (candidate.command !== 'node' || !Array.isArray(candidate.args)) return false;
  const script: unknown = candidate.args[0];
  if (typeof script !== 'string') return false;
  const parts = script.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.at(-1) !== 'mcp-server.js') return false;
  if (parts.at(-2) === 'bin') return true;
  return (
    parts.at(-2) === 'dist' &&
    (parts.at(-3) === 'coding-agents' || parts.at(-3) === 'hindsight-coding-agents')
  );
}

export function install(ctx: InstallContext = {}): InstallResult {
  const home = ctx.home ?? homedir();
  const pkgRoot = ctx.pkgRoot ?? defaultPkgRoot();
  const log = ctx.log ?? noop;

  const hooksPath = join(home, ...HOOKS_CONFIG_PATH);
  const appMcpPath = join(home, ...APP_MCP_CONFIG_PATH);
  const sharedMcpPath = join(home, ...SHARED_MCP_CONFIG_PATH);
  const pluginDir = join(home, ...PLUGIN_DIR);
  const skillDir = join(pluginDir, 'skills', SKILL_NAME);
  const rulesDir = join(pluginDir, 'rules');

  writeJson(hooksPath, mergeHooks(readJson(hooksPath), pkgRoot));
  log(`${HOST}: hooks merged into ${hooksPath}`);

  const appMcp = registerMcp(appMcpPath, pkgRoot, log);
  const sharedMcp = ctx.sharedMcp ? registerMcp(sharedMcpPath, pkgRoot, log) : 'skipped';
  if (appMcp === 'installed') log(`${HOST}: MCP server registered in ${appMcpPath}`);
  if (sharedMcp === 'installed') log(`${HOST}: MCP server registered in ${sharedMcpPath}`);

  writeJson(join(pluginDir, 'plugin.json'), pluginManifest(pkgRoot));

  const skill = copyDir(join(pkgRoot, 'skills', SKILL_NAME), skillDir) ? 'installed' : 'skipped';
  const rules = copyDir(join(pkgRoot, 'rules'), rulesDir) ? 'installed' : 'skipped';
  log(`${HOST}: plugin bundle written to ${pluginDir}` + ` (skill ${skill}, rules ${rules})`);

  return {
    hooksPath,
    appMcpPath,
    sharedMcpPath,
    pluginDir,
    skillDir,
    rulesDir,
    appMcp,
    sharedMcp,
    skill,
    rules,
  };
}

export function uninstall(ctx: InstallContext = {}): UninstallResult {
  const home = ctx.home ?? homedir();
  const log = ctx.log ?? noop;

  const hooksPath = join(home, ...HOOKS_CONFIG_PATH);
  const appMcpPath = join(home, ...APP_MCP_CONFIG_PATH);
  const sharedMcpPath = join(home, ...SHARED_MCP_CONFIG_PATH);
  const pluginDir = join(home, ...PLUGIN_DIR);

  if (existsSync(hooksPath)) {
    const hooks = readJson(hooksPath);
    const group = hooks[HOOK_NAME];
    if (group && typeof group === 'object') {
      const events = group as JsonRecord;
      for (const wiring of HOOK_WIRING) {
        setOrDelete(events, wiring.event, stripOurs(events[wiring.event], wiring));
      }
      if (Object.keys(events).length === 0) delete hooks[HOOK_NAME];
    }
    for (const wiring of HOOK_WIRING) {
      setOrDelete(hooks, wiring.event, stripOurs(hooks[wiring.event], wiring));
    }
    writeJson(hooksPath, hooks);
  }

  // Both registries, regardless of how this machine was installed: a user who once passed
  // `--shared-mcp` must not be left with an entry pointing at a plugin that is gone.
  for (const path of [appMcpPath, sharedMcpPath]) {
    if (!existsSync(path)) continue;
    const mcpConfig = readJson(path);
    const servers = record(mcpConfig.mcpServers);
    if (MCP_SERVER_NAME in servers && isOurMcpEntry(servers[MCP_SERVER_NAME])) {
      delete servers[MCP_SERVER_NAME];
      mcpConfig.mcpServers = servers;
      writeJson(path, mcpConfig);
    }
  }

  const pluginRemoved = removePluginDir(pluginDir);
  log(
    pluginRemoved
      ? `${HOST}: hooks + MCP entry + plugin bundle removed`
      : `${HOST}: hooks + MCP entry removed; ${pluginDir} left in place (not ours)`,
  );

  return { hooksPath, appMcpPath, sharedMcpPath, pluginDir, pluginRemoved };
}

/** Put our entry in one `mcp_config.json`, unless a foreign server already holds the name. */
function registerMcp(path: string, pkgRoot: string, log: (m: string) => void): McpOutcome {
  const mcpConfig = readJson(path);
  const servers = record(mcpConfig.mcpServers);
  const existing = servers[MCP_SERVER_NAME];

  if (existing !== undefined && !isOurMcpEntry(existing)) {
    log(
      `${HOST}: existing "${MCP_SERVER_NAME}" MCP server in ${path} preserved ` +
        `(Hindsight tools not registered)`,
    );
    return 'preserved';
  }

  mcpConfig.mcpServers = { ...servers, [MCP_SERVER_NAME]: mcpServerEntry(pkgRoot) };
  writeJson(path, mcpConfig);
  return 'installed';
}

/**
 * The bundle's `plugin.json`.
 *
 * The repo's own manifest is the template and carries no version — stamping the installed
 * package's version here is what keeps the two from drifting, which is exactly what happened while
 * the version was maintained by hand in two files. The manifest names no components: Antigravity
 * discovers a plugin's `skills/`, `rules/` and `agents/` by directory convention, and this bundle
 * deliberately has no `hooks.json` or `mcp_config.json` to point at.
 */
function pluginManifest(pkgRoot: string): JsonRecord {
  const template = readJson(join(pkgRoot, 'plugin.json'));
  const pkg = readJson(join(pkgRoot, 'package.json'));
  // `name` comes last on purpose: it has to agree with PLUGIN_DIR and with the check uninstall
  // makes before deleting the bundle, so the constant wins over whatever the template says.
  return {
    ...template,
    name: PLUGIN_NAME,
    ...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
  };
}

/** Merge our wiring into a hooks.json object, leaving every foreign entry in place. */
function mergeHooks(hooks: JsonRecord, pkgRoot: string): JsonRecord {
  // Upstream drops stale sibling keys that merely contain the hook name (an older spelling).
  for (const key of Object.keys(hooks)) {
    if (key !== HOOK_NAME && key.includes(HOOK_NAME)) delete hooks[key];
  }
  const group = record(hooks[HOOK_NAME]);
  for (const wiring of HOOK_WIRING) {
    group[wiring.event] = [...stripOurs(group[wiring.event], wiring), hookEntry(pkgRoot, wiring)];
  }
  hooks[HOOK_NAME] = group;
  // Older installs (and upstream's own) wrote straight into the top-level event arrays; leaving one
  // behind would run the hook twice per invocation.
  for (const wiring of HOOK_WIRING) {
    setOrDelete(hooks, wiring.event, stripOurs(hooks[wiring.event], wiring));
  }
  return hooks;
}

/** Every entry in `value` that is not ours — foreign hooks are never touched. */
function stripOurs(value: unknown, wiring: HookWiring): unknown[] {
  return (Array.isArray(value) ? value : []).filter((entry) => !isOurHookEntry(entry, wiring));
}

/**
 * Ours by either signature: upstream's hook name (its commands live under a `coding-agents`
 * directory) or a command spawning this package's wrapper for the same event. Matching only the name
 * would make a second install of *this* package append a duplicate entry instead of replacing its
 * own.
 */
function isOurHookEntry(entry: unknown, wiring: HookWiring): boolean {
  const json = JSON.stringify(entry) ?? '';
  return json.includes(HOOK_NAME) || json.replaceAll('\\\\', '/').includes(`/bin/${wiring.bin}`);
}

function setOrDelete(target: JsonRecord, key: string, entries: unknown[]): void {
  if (entries.length) target[key] = entries;
  else delete target[key];
}

/** Copy one directory of bundled assets. `false` when the package ships nothing there. */
function copyDir(source: string, target: string): boolean {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  return true;
}

/**
 * Delete the plugin bundle, but only once it is recognisably ours.
 *
 * The directory is namespaced to us, yet it is still a directory in the user's home that we would be
 * removing recursively. A `plugin.json` naming this plugin is cheap proof that we are deleting our
 * own bundle and not, say, a hand-written plugin that happens to share the name.
 */
function removePluginDir(pluginDir: string): boolean {
  if (!existsSync(pluginDir)) return true;
  if (readJson(join(pluginDir, 'plugin.json')).name !== PLUGIN_NAME) return false;
  rmSync(pluginDir, { recursive: true, force: true });
  return true;
}

/** Parse a JSON file into an object. Missing, unreadable or malformed reads as `{}`, never throws. */
function readJson(path: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function writeJson(path: string, value: JsonRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  backupOnce(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** A plain object view of a nested value, so a scalar or missing key cannot corrupt a merge. */
function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

/** The package root: this module is built into `dist/`, so the root is one level up. */
function defaultPkgRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

function noop(): void {
  /* callers that want output pass their own logger */
}
