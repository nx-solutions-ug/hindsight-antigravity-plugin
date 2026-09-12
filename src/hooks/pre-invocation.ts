/**
 * Antigravity's `PreInvocation` hook.
 *
 * The runtime does the work — it recovers the last user turn from the transcript, reflects, and
 * writes its own `injectSteps` reply. This wrapper only names the entry point and the reply that
 * means "inject nothing", for the case where the runtime cannot be started at all.
 */
import { delegateToRuntime, type DelegateOptions } from "./delegate.js";

/** A well-formed `PreInvocation` reply that adds no context. */
export const PRE_INVOCATION_FALLBACK = '{"injectSteps":[]}\n';

export async function runPreInvocation(
  overrides: Partial<DelegateOptions> = {}
): Promise<boolean> {
  return delegateToRuntime({
    ...overrides,
    entry: "antigravity-hook.js",
    fallback: PRE_INVOCATION_FALLBACK
  });
}

export { runPreInvocation as run };
