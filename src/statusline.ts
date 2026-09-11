/**
 * Antigravity's status line.
 *
 * The runtime prints `Hindsight · <bank>` as a bare string — the host renders whatever it reads on
 * stdout verbatim. There is therefore no safe fallback: a JSON object or an error message would be
 * shown to the user as if it were their status line, so when the runtime is unavailable this writes
 * nothing and the line simply stays empty.
 */
import { delegateToRuntime, type DelegateOptions } from "./hooks/delegate.js";

export async function runStatusLine(overrides: Partial<DelegateOptions> = {}): Promise<boolean> {
  return delegateToRuntime({
    ...overrides,
    entry: "antigravity-statusline.js",
    fallback: ""
  });
}

export { runStatusLine as run };
