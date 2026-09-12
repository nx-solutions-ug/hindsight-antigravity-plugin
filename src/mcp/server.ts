/**
 * The stdio MCP server the Antigravity desktop app connects to.
 *
 * The tools are the runtime's, not ours; this wrapper only tells it which harness is asking and
 * hands over the process. The harness it names has to be the one the hooks stamp — see
 * {@link RUNTIME_HARNESS} — or the `hindsight_*` tools would read a different config section, and
 * possibly a different bank, than the memory being recalled and retained around them.
 */
import { MCP_HARNESS_ENV, RUNTIME_HARNESS } from "../host.js";
import { delegateToRuntime, type DelegateOptions } from "../hooks/delegate.js";

export interface ServerOptions extends Partial<DelegateOptions> {
  /** Environment the harness marker is set on; defaults to this process's. */
  env?: NodeJS.ProcessEnv;
}

export async function runServer(overrides: ServerOptions = {}): Promise<boolean> {
  const { env = process.env, ...delegate } = overrides;

  // A host that pins the harness itself knows better than we do, so only fill in the blank.
  if (!env[MCP_HARNESS_ENV]) env[MCP_HARNESS_ENV] = RUNTIME_HARNESS;

  const ok = await delegateToRuntime({
    ...delegate,
    entry: "mcp-server.js",
    fallback: ""
  });

  // Unlike a hook, a server that answers nothing is worse than one that is plainly gone: the client
  // would wait on a stdio peer that will never speak. Fail visibly instead — but never throw.
  if (!ok) process.exitCode = 1;

  return ok;
}

export { runServer as run };
