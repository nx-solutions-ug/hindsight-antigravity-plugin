# GEMINI.md — Antigravity Directives

This file contains Antigravity-specific instructions, hook contracts, and local development
directives for `@chronova/hindsight-antigravity-plugin`. Universal project conventions are defined in
[AGENTS.md](./AGENTS.md).

The memory logic belongs to `@vectorize-io/hindsight-coding-agents`. What is specified here is the
contract between Antigravity and this package's wrappers.

---

## 1. Antigravity Hook Contracts

Antigravity's payloads are **not** Claude Code's. Do not assume `session_id`, `user_prompt` or
`hook_specific_output` — none of them exist here.

### `PreInvocation` Hook (`src/hooks/pre-invocation.ts` → `bin/pre-invocation.js`)

- **Input (stdin)**:
  ```json
  {
    "workspacePaths": ["/abs/path/to/workspace"],
    "conversationId": "string",
    "transcriptPath": "/abs/path/to/transcript.jsonl"
  }
  ```
  There is **no prompt field**. The runtime recovers the last user turn from the transcript JSONL
  itself — never add a prompt parameter or try to reconstruct one here.
- **Output (stdout)**:
  ```json
  { "injectSteps": [{ "ephemeralMessage": "…injected memory…" }] }
  ```
- **Contract Rules**:
  - Injected context goes in an `ephemeralMessage` step. Nothing else on stdout.
  - `PreInvocation` is Antigravity's **only** injection point, so it also carries the session-start
    work (seed, top-up, first-prompt reflect) that other harnesses run in a `SessionStart` hook. Do
    not add a second hook event for it.
  - Informational and debug output MUST go to `process.stderr`.

### `Stop` Hook (`src/hooks/stop-hook.ts` → `bin/stop-hook.js`)

- **Input (stdin)**:
  ```json
  {
    "conversationId": "string",
    "transcriptPath": "/abs/path/to/transcript.jsonl",
    "workspacePaths": ["/abs/path/to/workspace"]
  }
  ```
- **Output (stdout)**: `{}`
- **Contract Rule**: write-back (transcript parsing, dedup, retention) is the runtime's. This
  wrapper names the entry point and the empty reply; it parses no transcripts and keeps no
  watermarks.

---

## 2. The Fail-Safe Rule

A hook that crashes, or writes something the host cannot parse, can stall a turn. Memory is
best-effort; the session is not.

- When the runtime cannot be started at all, the wrapper writes the event's **neutral reply** —
  `{"injectSteps":[]}` for `PreInvocation`, `{}` for `Stop` — logs the reason to `stderr`, and exits
  **zero**. Never a non-zero exit, never an empty stdout, never a thrown error.
- Failures *inside* the runtime are the runtime's own to report: it already answers the host and
  writes its diagnostics. Only a failure to start it is handled here (`src/hooks/delegate.ts`).
- The **status line** (`bin/statusline.js`) has no neutral reply: Antigravity renders stdout
  verbatim, so a JSON object or an error string would be displayed to the user as their status line.
  When the runtime is unavailable it prints **nothing** and the line stays empty.
- The MCP server is the one exception to silent degradation: a stdio server that answers nothing
  leaves the client waiting on a peer that will never speak, so it sets a non-zero `process.exitCode`
  — without throwing — when the runtime cannot start.

---

## 3. Stdio MCP Server Protocol

The MCP server (`src/mcp/server.ts` → `bin/mcp-server.js`) hands the process to the runtime's
`dist/mcp-server.js`, setting `HINDSIGHT_MCP_HARNESS=antigravity-cli` when the host has not pinned it
already.

- stdout belongs to the MCP protocol. Never `console.log` anywhere on an MCP execution path; all
  logging goes to `console.error`/`stderr`.
- The tools are the runtime's (`hindsight_search_knowledge_pages`, `hindsight_read_knowledge_page`,
  `hindsight_list_knowledge_pages`, `hindsight_reflect`, `hindsight_ingest_document`,
  `hindsight_capture_initiative`, `hindsight_diagnose`, `hindsight_sync_status`). Do not define,
  wrap, rename or filter tools in this package.

---

## 4. Local Testing & Dogfooding in Antigravity

```bash
# 1. Build TypeScript sources
bun run build

# 2. Run tests and type check
bun test
bun run lint

# 3. Wire into the active Antigravity configuration
node ./bin/install.js
```

The installer **merges into your existing `~/.gemini/config/*`** — it no longer copies a plugin
directory into `~/.gemini/config/plugins/hindsight`:

- `~/.gemini/config/hooks.json` — the two hooks, grouped under the `coding-agents` key.
- `~/.gemini/config/mcp_config.json` — `mcpServers.hindsight`, with
  `HINDSIGHT_MCP_HARNESS=antigravity-cli`.
- `~/.gemini/antigravity-cli/settings.json` — the status line (an existing custom one is preserved).
- `~/.gemini/config/skills/hindsight-coding-agent` — the companion skill.

Each file is backed up once to `<path>.hindsight-backup`. `node ./bin/install.js uninstall` removes
exactly what was added and leaves foreign entries alone. Restart `agy` to pick up new wiring.

`npx @vectorize-io/hindsight-coding-agents install agy` writes the same entries under the same
marker, so keep the two in sync when changing `src/harness.ts` or `src/installer.ts` — either route
must be able to replace and uninstall the other's entries.
