/**
 * The plugin's public surface: the wiring it declares for the Antigravity desktop app, the runtime
 * it resolves, and the three entry points it exposes to the host.
 */
export * from "./host.js";
export * from "./runtime.js";
export * from "./config.js";
export * from "./installer.js";
export * from "./hooks/delegate.js";

export { PRE_INVOCATION_FALLBACK, runPreInvocation } from "./hooks/pre-invocation.js";
export { STOP_FALLBACK, runStopHook } from "./hooks/stop-hook.js";
export { runServer, type ServerOptions } from "./mcp/server.js";
