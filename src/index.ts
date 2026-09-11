/**
 * The plugin's public surface: the wiring it declares, the runtime it resolves, and the four
 * entry points it exposes to Antigravity.
 */
export * from "./harness.js";
export * from "./runtime.js";
export * from "./config.js";
export * from "./installer.js";
export * from "./hooks/delegate.js";

export { PRE_INVOCATION_FALLBACK, runPreInvocation } from "./hooks/pre-invocation.js";
export { STOP_FALLBACK, runStopHook } from "./hooks/stop-hook.js";
export { runStatusLine } from "./statusline.js";
export { runServer, type ServerOptions } from "./mcp/server.js";
