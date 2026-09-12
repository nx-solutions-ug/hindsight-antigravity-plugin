#!/usr/bin/env node
/**
 * Wire this plugin into Antigravity (or take it back out).
 *
 * Dependency-free on purpose: it runs straight after `npm i -g`, before anything has been built in
 * the user's checkout, so it may import only the package's own compiled output.
 */
import {
  configPath,
  describeServer,
  install,
  readConfig,
  uninstall,
  writeConfig
} from "../dist/installer.js";

const USAGE = `hindsight-antigravity-install [install|uninstall] [options]

  install        wire hooks, MCP server, status line and skill into Antigravity (default)
  uninstall      remove exactly what install added, leaving foreign entries alone

Options (install only; each seeds ~/.hindsight/coding-agent.json when it does not already
say where the server is — an existing choice is never overwritten):

  --server <cloud|self-hosted|daemon>   which Hindsight server to use
  --api-url <url>                       server URL (self-hosted)
  --api-token <token>                   API token (cloud, or an authenticated self-hosted server)
  -h, --help                            show this message
`;

const SERVER_MODES = ["cloud", "self-hosted", "daemon"];

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const verb = argv[0] && !argv[0].startsWith("-") ? argv[0] : "install";
if (verb !== "install" && verb !== "uninstall") {
  process.stderr.write(`unknown command "${verb}"\n\n${USAGE}`);
  process.exit(1);
}

const log = (message) => process.stdout.write(`${message}\n`);

/** Value of `--name <value>`, or undefined. */
function flag(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

if (verb === "uninstall") {
  const result = uninstall({ log });
  log(`Hindsight removed from ${result.hooksPath}, ${result.mcpPath} and ${result.settingsPath}.`);
  process.exit(0);
}

const mode = flag("server");
if (mode !== undefined && !SERVER_MODES.includes(mode)) {
  process.stderr.write(`unknown --server "${mode}" — expected one of: ${SERVER_MODES.join(", ")}\n`);
  process.exit(1);
}

const path = configPath();
const config = readConfig(path);
// The file is the runtime's source of truth and the user's to edit: only fill in fields it leaves
// blank, so re-running the installer can never silently repoint an existing setup.
const seeded = [];
const seed = (key, value) => {
  if (value === undefined || config[key] !== undefined) return;
  config[key] = value;
  seeded.push(key);
};
seed("serverMode", mode);
seed("apiUrl", flag("api-url"));
seed("apiToken", flag("api-token"));

if (seeded.length) {
  writeConfig(config, path);
  log(`Seeded ${seeded.join(", ")} in ${path}.`);
}

const result = install({ log });
const server = describeServer(config);

log("");
log(`Hindsight is wired into Antigravity (${result.hooksPath}).`);
log(
  `  server:      ${server.mode}${server.apiUrl ? ` (${server.apiUrl})` : ""}` +
    `${server.hasToken ? " with API token" : " without API token"}` +
    `${server.source === "default" ? " — default; set one with --server" : ""}`
);
log(`  config:      ${path}`);
log(`  MCP server:  ${result.mcp === "installed" ? result.mcpPath : "preserved existing entry"}`);
log(`  status line: ${result.statusLine === "installed" ? result.settingsPath : "preserved yours"}`);
log(`  skill:       ${result.skill === "installed" ? result.skillDir : "not bundled — skipped"}`);
log("");
log("Restart `agy` to pick up the new wiring.");
