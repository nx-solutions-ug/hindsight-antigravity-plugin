/**
 * Wiring this plugin into an Antigravity install, and taking it back out again.
 *
 * This is upstream's `install agy` with one substitution: every path points at this package's own
 * `bin/` wrappers instead of the runtime's `dist/`. The wrappers add the fail-safe reply the host
 * needs when memory is unreachable, and give the host a path that stays valid when the runtime is
 * upgraded underneath us. Everything else — the files touched, the grouping key, the backup rule,
 * the "preserve a foreign entry" rule — matches upstream exactly, so a machine wired by either
 * route behaves the same and can be cleaned up by either side.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backupOnce } from "./config.js";
import {
  HARNESS,
  HOOKS_CONFIG_PATH,
  HOOK_MARKER,
  HOOK_WIRING,
  MCP_CONFIG_PATH,
  MCP_HARNESS_ENV,
  MCP_SERVER_NAME,
  SETTINGS_PATH,
  SKILLS_DIR,
  SKILL_NAME,
  type HookWiring,
  type PluginBin
} from "./harness.js";

/**
 * Re-exported so `bin/install.js` needs exactly one built entry point: the seeding it does before
 * wiring reads and writes the same config file the installer reports on.
 */
export { configPath, describeServer, readConfig, writeConfig } from "./config.js";

type JsonRecord = Record<string, unknown>;

export interface InstallContext {
  /** User's home directory. Defaults to `os.homedir()`; tests point it at a scratch directory. */
  home?: string;
  /** This package's root. Defaults to the directory containing `bin/` and `skills/`. */
  pkgRoot?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

export interface InstallResult {
  hooksPath: string;
  mcpPath: string;
  settingsPath: string;
  skillDir: string;
  statusLine: "installed" | "preserved";
  mcp: "installed" | "preserved";
  skill: "installed" | "skipped";
}

export interface UninstallResult {
  hooksPath: string;
  mcpPath: string;
  settingsPath: string;
  skillDir: string;
}

/** Absolute path of one of this package's executable wrappers. */
export function binPath(pkgRoot: string, bin: PluginBin): string {
  return join(pkgRoot, "bin", bin);
}

/** A hook entry in Antigravity's flat style: a command string plus a timeout in seconds. */
export function hookEntry(
  pkgRoot: string,
  wiring: HookWiring
): { command: string; timeout?: number } {
  return {
    command: `node "${binPath(pkgRoot, wiring.bin)}"`,
    ...(wiring.timeout ? { timeout: wiring.timeout } : {})
  };
}

/** The stdio MCP server entry Antigravity spawns for the `hindsight_*` tools. */
export function mcpServerEntry(
  pkgRoot: string
): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: "node",
    args: [binPath(pkgRoot, "mcp-server.js")],
    env: { [MCP_HARNESS_ENV]: HARNESS }
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
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { command?: unknown; args?: unknown };
  if (candidate.command !== "node" || !Array.isArray(candidate.args)) return false;
  const script: unknown = candidate.args[0];
  if (typeof script !== "string") return false;
  const parts = script.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.at(-1) !== "mcp-server.js") return false;
  if (parts.at(-2) === "bin") return true;
  return (
    parts.at(-2) === "dist" &&
    (parts.at(-3) === "coding-agents" || parts.at(-3) === "hindsight-coding-agents")
  );
}

export function install(ctx: InstallContext = {}): InstallResult {
  const home = ctx.home ?? homedir();
  const pkgRoot = ctx.pkgRoot ?? defaultPkgRoot();
  const log = ctx.log ?? noop;

  const hooksPath = join(home, ...HOOKS_CONFIG_PATH);
  const mcpPath = join(home, ...MCP_CONFIG_PATH);
  const settingsPath = join(home, ...SETTINGS_PATH);
  const skillDir = join(home, ...SKILLS_DIR, SKILL_NAME);

  writeJson(hooksPath, mergeHooks(readJson(hooksPath), pkgRoot));

  const mcpConfig = readJson(mcpPath);
  const servers = record(mcpConfig.mcpServers);
  const existingServer = servers[MCP_SERVER_NAME];
  let mcp: InstallResult["mcp"] = "installed";
  if (existingServer !== undefined && !isOurMcpEntry(existingServer)) {
    mcp = "preserved";
    log(
      `${HARNESS}: existing "${MCP_SERVER_NAME}" MCP server preserved (Hindsight tools not registered)`
    );
  } else {
    mcpConfig.mcpServers = { ...servers, [MCP_SERVER_NAME]: mcpServerEntry(pkgRoot) };
    writeJson(mcpPath, mcpConfig);
  }

  const settings = readJson(settingsPath);
  let statusLine: InstallResult["statusLine"] = "installed";
  if (settings.statusLine === undefined || isOursByMarker(settings.statusLine)) {
    const announce = settings.statusLine === undefined;
    settings.statusLine = statusLineEntry(pkgRoot);
    writeJson(settingsPath, settings);
    if (announce) log(`${HARNESS}: Hindsight status line enabled in ${settingsPath}`);
  } else {
    statusLine = "preserved";
    log(`${HARNESS}: existing custom status line preserved (Hindsight indicator not added)`);
  }

  log(`${HARNESS}: hooks merged into ${hooksPath}, MCP into ${mcpPath}`);

  const skill = installSkill(pkgRoot, skillDir) ? "installed" : "skipped";
  log(
    skill === "installed"
      ? `${HARNESS}: skill installed at ${skillDir}`
      : `${HARNESS}: no skill bundled in this package — skipped`
  );

  return { hooksPath, mcpPath, settingsPath, skillDir, statusLine, mcp, skill };
}

export function uninstall(ctx: InstallContext = {}): UninstallResult {
  const home = ctx.home ?? homedir();
  const log = ctx.log ?? noop;

  const hooksPath = join(home, ...HOOKS_CONFIG_PATH);
  const mcpPath = join(home, ...MCP_CONFIG_PATH);
  const settingsPath = join(home, ...SETTINGS_PATH);
  const skillDir = join(home, ...SKILLS_DIR, SKILL_NAME);

  if (existsSync(hooksPath)) {
    const hooks = readJson(hooksPath);
    const group = hooks[HOOK_MARKER];
    if (group && typeof group === "object") {
      const events = group as JsonRecord;
      for (const wiring of HOOK_WIRING) {
        setOrDelete(events, wiring.event, stripOurs(events[wiring.event], wiring));
      }
      if (Object.keys(events).length === 0) delete hooks[HOOK_MARKER];
    }
    for (const wiring of HOOK_WIRING) {
      setOrDelete(hooks, wiring.event, stripOurs(hooks[wiring.event], wiring));
    }
    writeJson(hooksPath, hooks);
  }

  if (existsSync(mcpPath)) {
    const mcpConfig = readJson(mcpPath);
    const servers = record(mcpConfig.mcpServers);
    if (MCP_SERVER_NAME in servers && isOurMcpEntry(servers[MCP_SERVER_NAME])) {
      delete servers[MCP_SERVER_NAME];
      mcpConfig.mcpServers = servers;
      writeJson(mcpPath, mcpConfig);
    }
  }

  if (existsSync(settingsPath)) {
    const settings = readJson(settingsPath);
    if (settings.statusLine !== undefined && isOursByMarker(settings.statusLine)) {
      delete settings.statusLine;
      writeJson(settingsPath, settings);
    }
  }

  rmSync(skillDir, { recursive: true, force: true });

  log(`${HARNESS}: hooks + MCP entry + status line + skill removed`);
  return { hooksPath, mcpPath, settingsPath, skillDir };
}

/** Merge our wiring into a hooks.json object, leaving every foreign entry in place. */
function mergeHooks(hooks: JsonRecord, pkgRoot: string): JsonRecord {
  // Upstream drops stale sibling keys that merely contain the marker (an older grouping spelling).
  for (const key of Object.keys(hooks)) {
    if (key !== HOOK_MARKER && key.includes(HOOK_MARKER)) delete hooks[key];
  }
  const group = record(hooks[HOOK_MARKER]);
  for (const wiring of HOOK_WIRING) {
    group[wiring.event] = [...stripOurs(group[wiring.event], wiring), hookEntry(pkgRoot, wiring)];
  }
  hooks[HOOK_MARKER] = group;
  // Older installs (and upstream's own) wrote straight into the top-level event arrays; leaving one
  // behind would run the hook twice per invocation.
  for (const wiring of HOOK_WIRING) {
    setOrDelete(hooks, wiring.event, stripOurs(hooks[wiring.event], wiring));
  }
  return hooks;
}

function statusLineEntry(pkgRoot: string): { type: string; command: string } {
  return { type: "command", command: `node "${binPath(pkgRoot, "statusline.js")}"` };
}

/** Every entry in `value` that is not ours — foreign hooks are never touched. */
function stripOurs(value: unknown, wiring: HookWiring): unknown[] {
  return (Array.isArray(value) ? value : []).filter((entry) => !isOurHookEntry(entry, wiring));
}

/**
 * Ours by either signature: upstream's marker (its commands live under a `coding-agents` directory)
 * or a command spawning this package's wrapper for the same event. Matching only the marker would
 * make a second install of *this* package append a duplicate entry instead of replacing its own.
 */
function isOurHookEntry(entry: unknown, wiring: HookWiring): boolean {
  const json = JSON.stringify(entry) ?? "";
  return json.includes(HOOK_MARKER) || json.replaceAll("\\\\", "/").includes(`/bin/${wiring.bin}`);
}

/** Ours by upstream's rule: the serialised value mentions the marker, or one of our wrappers. */
function isOursByMarker(value: unknown): boolean {
  const json = (JSON.stringify(value) ?? "").replaceAll("\\\\", "/");
  return json.includes(HOOK_MARKER) || json.includes("/bin/statusline.js");
}

function setOrDelete(target: JsonRecord, key: string, entries: unknown[]): void {
  if (entries.length) target[key] = entries;
  else delete target[key];
}

/** Copy the bundled skill into the host's skills directory. `false` when nothing is bundled. */
function installSkill(pkgRoot: string, skillDir: string): boolean {
  const source = join(pkgRoot, "skills", SKILL_NAME);
  if (!existsSync(join(source, "SKILL.md"))) return false;
  mkdirSync(dirname(skillDir), { recursive: true });
  cpSync(source, skillDir, { recursive: true });
  return true;
}

/** Parse a JSON file into an object. Missing, unreadable or malformed reads as `{}`, never throws. */
function readJson(path: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
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
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

/** The package root: this module is built into `dist/`, so the root is one level up. */
function defaultPkgRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function noop(): void {
  /* callers that want output pass their own logger */
}
