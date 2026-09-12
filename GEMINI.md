# GEMINI.md — Antigravity Directives

This file contains Antigravity-specific instructions, hook contracts, and local development
directives for `@chronova/hindsight-antigravity-plugin`. Universal project conventions are defined in
[AGENTS.md](./AGENTS.md).

The host is the **Antigravity desktop application**, not `agy`. The memory logic belongs to
`@vectorize-io/hindsight-coding-agents`. What is specified here is the contract between the app and
this package's wrappers.

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
- Failures _inside_ the runtime are the runtime's own to report: it already answers the host and
  writes its diagnostics. Only a failure to start it is handled here (`src/hooks/delegate.ts`).
- There is **no status line** to fail safe. It is a feature of the CLI's TUI, rendered from
  `~/.gemini/antigravity-cli/settings.json`; the desktop app draws its own chrome and has nothing to
  render a command's stdout into, so this package ships no status-line wrapper at all.
- The MCP server is the one exception to silent degradation: a stdio server that answers nothing
  leaves the client waiting on a peer that will never speak, so it sets a non-zero `process.exitCode`
  — without throwing — when the runtime cannot start.

---

## 3. Stdio MCP Server Protocol

The MCP server (`src/mcp/server.ts` → `bin/mcp-server.js`) hands the process to the runtime's
`dist/mcp-server.js`, setting `HINDSIGHT_MCP_HARNESS=antigravity-cli` when the host has not pinned it
already.

That value is **not** `antigravity`, deliberately. `dist/antigravity-hook.js` and
`dist/antigravity-stop-hook.js` call `runHarnessPrompt("antigravity-cli")` / `runHarnessRetain(…)`
with no override, so the hooks stamp that id whatever surface they run under. Since the id selects
the `harnesses.<id>` config section and feeds `{harness}` in `bankIdTemplate`, giving the MCP server
a different one would point the `hindsight_*` tools at a different config section — and possibly a
different bank — than the memory being recalled and retained around them. `src/host.ts` keeps `HOST`
(`"antigravity"`, the app) and `RUNTIME_HARNESS` (`"antigravity-cli"`, the runtime's protocol id) as
two separate constants for this reason.

- stdout belongs to the MCP protocol. Never `console.log` anywhere on an MCP execution path; all
  logging goes to `console.error`/`stderr`.
- The tools are the runtime's (`hindsight_search_knowledge_pages`, `hindsight_read_knowledge_page`,
  `hindsight_list_knowledge_pages`, `hindsight_reflect`, `hindsight_ingest_document`,
  `hindsight_capture_initiative`, `hindsight_diagnose`, `hindsight_sync_status`). Do not define,
  wrap, rename or filter tools in this package.

---

## 4. Install Targets

```bash
# 1. Build TypeScript sources
bun run build

# 2. Run tests and type check
bun test
bun run lint

# 3. Wire into the Antigravity desktop app, then restart it
node ./bin/install.js
```

Three targets, because the app splits them that way:

| path                                    | why there                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `~/.gemini/config/hooks.json`           | the global hooks file every Antigravity flavour reads; the app has none of its own |
| `~/.gemini/antigravity/mcp_config.json` | the app's **own** MCP registry — the file its "Open MCP Config" button opens       |
| `~/.gemini/config/plugins/hindsight/`   | a namespaced plugin bundle: `plugin.json`, `skills/`, `rules/`                     |

`--shared-mcp` additionally writes Antigravity 2.x's shared `~/.gemini/config/mcp_config.json`. It is
opt-in because a host that reads both files lists `hindsight` twice; uninstall cleans both regardless.

### Rules this file exists to state

- **Never write under `~/.gemini/antigravity-cli/`.** That tree — `settings.json`, the status line,
  the plugin staging directory — belongs to `agy` and to upstream's `install agy`.
- **The plugin bundle carries no `hooks.json` and no `mcp_config.json`.** The format allows both, but
  a plugin-level copy is a _second_ registration of the same command: two `PreInvocation` entries
  inject memory twice and retain the turn twice. Declarative content (skills, rules) is idempotent
  and belongs in the bundle; anything that spawns a process is registered once, at host level.
- **Commands are absolute paths, written at install time.** Antigravity expands no placeholder in
  these files — not `${workspaceFolder}`, and nothing reliable for a plugin root — so a shipped
  template could only ever be spawned verbatim and fail.
- **`plugin.json` in the repo carries no version.** The installer stamps `package.json`'s, so the two
  cannot drift the way they did when both were maintained by hand.

Each file is backed up once to `<path>.hindsight-backup`. `node ./bin/install.js uninstall` removes
exactly what was added and leaves foreign entries alone. Restart the **Antigravity app** to pick up
new wiring.

`npx @vectorize-io/hindsight-coding-agents install agy` wires the same runtime into the CLI under the
same `coding-agents` hook name, so keep the hook _protocol_ in `src/host.ts` in sync with upstream —
either route must be able to replace and uninstall the other's hook entries. The _files written_
differ on purpose, and that difference is the whole point of this package.
