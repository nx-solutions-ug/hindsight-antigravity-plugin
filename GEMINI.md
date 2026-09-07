# GEMINI.md — Antigravity IDE Directives

This file contains Antigravity IDE-specific instructions, hook contracts, and local development directives for `@chronova/hindsight-antigravity-plugin`. Universal project conventions are defined in [AGENTS.md](./AGENTS.md).

---

## 1. Antigravity Hook Contracts

When modifying or testing the plugin hooks:

### `PreInvocation` Hook (`src/hooks/pre-invocation.ts`)
- **Input (stdin)**:
  ```json
  {
    "session_id": "string",
    "turn_index": 0,
    "user_prompt": "string",
    "workspace_root": "string"
  }
  ```
- **Output (stdout)**:
  ```json
  {
    "hook_specific_output": {
      "additionalContext": "<hindsight_mental_models>...</hindsight_mental_models>\n\n<hindsight_recalled_memories>...</hindsight_recalled_memories>"
    }
  }
  ```
- **Contract Rule**: All injected context MUST be placed in `hook_specific_output.additionalContext`. Any informational or debug messages MUST be written to `process.stderr`, never `process.stdout`.

### `Stop` Hook (`src/hooks/stop-hook.ts`)
- **Input (stdin)**:
  ```json
  {
    "session_id": "string",
    "transcript_path": "/path/to/transcript.jsonl",
    "workspace_root": "string"
  }
  ```
- **Output (stdout)**:
  ```json
  {}
  ```
- **Contract Rule**:
  - The stop hook runs asynchronously at the end of a session.
  - It MUST maintain a watermark file (`.hindsight/watermark-${sessionId}.json`) so that repeatedly stopping does not duplicate retention.
  - It MUST sanitize synthetic context blocks (`<hindsight_mental_models>` and `<hindsight_recalled_memories>`) so that the agent's previous memory injections do not get retained as user or assistant words.

---

## 2. Stdio MCP Server Protocol

The plugin MCP server (`src/mcp/server.ts`) communicates exclusively over standard I/O:
- Initialized via `@modelcontextprotocol/sdk/server/stdio.js`.
- Never print arbitrary `console.log` statements inside MCP server execution paths. All logging must go to `console.error`.

---

## 3. Local Testing & Dogfooding in Antigravity

To test changes locally in your current Antigravity environment:

```bash
# 1. Build TypeScript sources
bun run build

# 2. Run all tests
bun test

# 3. Install locally into active Antigravity configuration
node ./bin/install.js
```

This copies the plugin bundle to `~/.gemini/config/plugins/hindsight` and registers `"plugins": { "hindsight": { "enabled": true } }` in `~/.gemini/config/config.json`.
