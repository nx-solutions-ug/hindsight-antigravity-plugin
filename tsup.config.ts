import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "pre-invocation": "src/hooks/pre-invocation.ts",
    "stop-hook": "src/hooks/stop-hook.ts",
    statusline: "src/statusline.ts",
    "mcp-server": "src/mcp/server.ts",
    installer: "src/installer.ts"
  },
  format: ["esm"],
  target: "node18",
  dts: true,
  clean: true,
  sourcemap: true,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node\n"
  }
});
