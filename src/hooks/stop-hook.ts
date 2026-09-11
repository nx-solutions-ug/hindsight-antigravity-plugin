/**
 * Antigravity's `Stop` hook.
 *
 * The runtime reads the finished transcript and writes back whatever it learned. Nothing is
 * injected here, so the host expects an empty object either way.
 */
import { delegateToRuntime, type DelegateOptions } from "./delegate.js";

/** A well-formed `Stop` reply. */
export const STOP_FALLBACK = "{}\n";

export async function runStopHook(overrides: Partial<DelegateOptions> = {}): Promise<boolean> {
  return delegateToRuntime({
    ...overrides,
    entry: "antigravity-stop-hook.js",
    fallback: STOP_FALLBACK
  });
}

export { runStopHook as run };
