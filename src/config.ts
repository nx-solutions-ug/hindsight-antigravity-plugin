/**
 * Reading (and minimally seeding) Hindsight's coding-agent config file.
 *
 * The runtime resolves its own configuration — defaults, then environment, then the file's top
 * level, then `harnesses.<name>`, then `banks.<bankId>` — and this plugin deliberately does not
 * reimplement any of that: a second resolver would drift from the one that actually decides where
 * memory goes. What lives here is only what the installer needs: find the file, read it without
 * ever throwing, write it back when seeding a fresh machine, and summarise which server the user
 * is pointed at so the install output can say where memory will live.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One bank per repository, shared by every agent working in it — the runtime's own default. */
export const DEFAULT_BANK_ID_TEMPLATE = "coding-agent::{gitProject}";

/** Where the config file lives, relative to the user's home directory. */
const CONFIG_RELATIVE = [".hindsight", "coding-agent.json"] as const;

/** Env var that relocates the config file itself (containers, CI, test harnesses). */
const CONFIG_ENV = "HINDSIGHT_CONFIG";

/** Suffix of the one-time backup taken before the first write to any file we touch. */
const BACKUP_SUFFIX = ".hindsight-backup";

/** Default daemon port, when `serverMode` is `daemon` and no `apiPort` is set. */
export const DEFAULT_API_PORT = 9077;

/** Hosted Hindsight endpoint, used when `serverMode` is `cloud`. */
export const CLOUD_API_URL = "https://api.hindsight.vectorize.io";

export type ServerMode = "cloud" | "self-hosted" | "daemon";

const SERVER_MODES: readonly ServerMode[] = ["cloud", "self-hosted", "daemon"];

/** True when `value` names one of the runtime's server modes. */
export function isServerMode(value: unknown): value is ServerMode {
  return typeof value === "string" && (SERVER_MODES as readonly string[]).includes(value);
}

/**
 * The subset of the runtime's config we read. The index signature is not laziness: the file is the
 * runtime's, it carries many more settings than this plugin knows about, and every read-modify-write
 * here has to preserve the ones it does not understand.
 */
export interface CodingAgentConfig {
  apiUrl?: string;
  apiToken?: string;
  serverMode?: ServerMode;
  apiPort?: number;
  bankIdTemplate?: string;
  disabled?: boolean;
  harnesses?: Record<string, Record<string, unknown>>;
  banks?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/** Absolute path of the config file. `HINDSIGHT_CONFIG` wins over the home-relative default. */
export function configPath(opts?: { env?: NodeJS.ProcessEnv; home?: string }): string {
  const env = opts?.env ?? process.env;
  const relocated = env[CONFIG_ENV];
  if (relocated && relocated.trim()) return relocated;
  return join(opts?.home ?? homedir(), ...CONFIG_RELATIVE);
}

/**
 * Read the config file. A missing, unreadable or malformed file reads as `{}` — the runtime treats
 * an absent config as "all defaults", and the installer must not be the thing that breaks on a
 * half-written file.
 */
export function readConfig(path?: string): CodingAgentConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path ?? configPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CodingAgentConfig)
      : {};
  } catch {
    return {};
  }
}

/** Write the config file: directory created, one-time backup taken, 2-space JSON, trailing newline. */
export function writeConfig(config: CodingAgentConfig, path?: string): void {
  const target = path ?? configPath();
  mkdirSync(dirname(target), { recursive: true });
  backupOnce(target);
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Copy a file aside before the first time we rewrite it, and never again — a second backup would
 * overwrite the user's original with our own earlier output.
 */
export function backupOnce(path: string): void {
  const backup = `${path}${BACKUP_SUFFIX}`;
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup);
}

export interface ServerDescription {
  mode: ServerMode;
  apiUrl?: string;
  hasToken: boolean;
  /** Where the choice came from, so install output can say whether anything is actually set. */
  source: "config" | "env" | "default";
}

/**
 * Summarise which Hindsight server the runtime will talk to.
 *
 * Mirrors the runtime's layering for the two fields the installer reports on: environment variables
 * are a *fallback*, so the file wins wherever it sets a value, and built-in defaults come last.
 */
export function describeServer(
  config: CodingAgentConfig,
  env: NodeJS.ProcessEnv = process.env
): ServerDescription {
  const envMode = isServerMode(env.HINDSIGHT_SERVER_MODE) ? env.HINDSIGHT_SERVER_MODE : undefined;
  const envUrl = nonEmpty(env.HINDSIGHT_API_URL);
  const configMode = isServerMode(config.serverMode) ? config.serverMode : undefined;
  const configUrl = nonEmpty(typeof config.apiUrl === "string" ? config.apiUrl : undefined);

  const source: ServerDescription["source"] =
    configMode || configUrl ? "config" : envMode || envUrl ? "env" : "default";

  const mode: ServerMode = configMode ?? envMode ?? (configUrl || envUrl ? "self-hosted" : "cloud");
  const apiUrl = configUrl ?? envUrl ?? defaultUrlFor(mode, config, env);

  const hasToken = Boolean(
    nonEmpty(typeof config.apiToken === "string" ? config.apiToken : undefined) ??
      nonEmpty(env.HINDSIGHT_API_TOKEN)
  );

  return { mode, ...(apiUrl ? { apiUrl } : {}), hasToken, source };
}

/** Cloud and daemon have known endpoints; a self-hosted server without a URL has none to report. */
function defaultUrlFor(
  mode: ServerMode,
  config: CodingAgentConfig,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (mode === "cloud") return CLOUD_API_URL;
  if (mode !== "daemon") return undefined;
  const envPort = Number.parseInt(env.HINDSIGHT_API_PORT ?? "", 10);
  const port =
    typeof config.apiPort === "number" && Number.isFinite(config.apiPort)
      ? config.apiPort
      : Number.isFinite(envPort)
        ? envPort
        : DEFAULT_API_PORT;
  return `http://127.0.0.1:${port}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
