/**
 * The one rule every Antigravity hook obeys: answer, whatever happened.
 *
 * A hook that crashes, or writes nothing a host can parse, is a hook that can stall a turn. So each
 * wrapper hands off to the runtime and, if the runtime cannot be resolved at all, writes the
 * event's neutral reply instead and keeps the exit code at zero. Memory is best-effort; the session
 * is not.
 */
import { runRuntimeEntry, RuntimeUnavailableError } from "../runtime.js";
import type { RuntimeEntry } from "../host.js";

export interface DelegateOptions {
  /** Runtime entry point to run. */
  entry: RuntimeEntry;
  /** Written to stdout when the runtime could not be started. Empty string writes nothing. */
  fallback: string;
  /** Injection seam for tests; defaults to running the real runtime. */
  run?: (entry: RuntimeEntry) => Promise<void>;
  /** Injection seam for tests; defaults to `process.stdout.write`. */
  stdout?: (chunk: string) => void;
  /** Injection seam for tests; defaults to `process.stderr.write`. */
  stderr?: (chunk: string) => void;
}

/**
 * Run `entry`, falling back to a neutral reply when the runtime is unavailable.
 *
 * Returns `true` when the runtime ran, `false` when the fallback was used. Failures inside the
 * runtime are the runtime's own to report — it already answers the host and logs its diagnostics —
 * so only a failure to start it is handled here.
 */
export async function delegateToRuntime(options: DelegateOptions): Promise<boolean> {
  const run = options.run ?? runRuntimeEntry;
  const write = options.stdout ?? ((chunk: string) => void process.stdout.write(chunk));
  const warn = options.stderr ?? ((chunk: string) => void process.stderr.write(chunk));

  try {
    await run(options.entry);
    return true;
  } catch (error) {
    const reason =
      error instanceof RuntimeUnavailableError || error instanceof Error
        ? error.message
        : String(error);
    warn(`hindsight: ${reason}\n`);
    if (options.fallback) write(options.fallback);
    return false;
  }
}
