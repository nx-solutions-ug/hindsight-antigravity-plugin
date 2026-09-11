# Hindsight Antigravity Plugin

Long-term project memory for **Google Antigravity** (`agy`), backed by
[Hindsight](https://hindsight.vectorize.io). This package is the Antigravity packaging of
[`@vectorize-io/hindsight-coding-agents`](https://github.com/vectorize-io/hindsight) — it wires that
runtime's `antigravity-cli` harness into Antigravity's lifecycle hooks, its stdio MCP server, its
status line and its companion skill, and implements no memory logic of its own. Everything about how
memory is recalled, retained, scoped to a bank and configured belongs to the runtime; this plugin's
job is wiring, fail-safe delegation and packaging.

There is **no setup command and no ingest command**. Open a repo in Antigravity and the memory for
that repo builds itself in the background.

---

## Installation

### Option 1: As an Antigravity plugin

The repository is a plugin in its own right — `plugin.json`, `hooks.json` and `mcp_config.json`
point at this package's `bin/` wrappers via `${PLUGIN_ROOT}`. Install it the way you install any
Antigravity plugin, or from a checkout:

```bash
bun install
bun run build
```

### Option 2: Merge the wiring into your Antigravity config

```bash
node ./bin/install.js
```

This merges the same wiring into your existing Antigravity configuration rather than copying a
plugin directory:

| file                                          | what is added                                                     |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `~/.gemini/config/hooks.json`                  | the `PreInvocation` and `Stop` hooks, grouped under `coding-agents` |
| `~/.gemini/config/mcp_config.json`             | `mcpServers.hindsight`, with `HINDSIGHT_MCP_HARNESS=antigravity-cli` |
| `~/.gemini/antigravity-cli/settings.json`      | the `Hindsight · <bank>` status line (an existing custom status line is preserved) |
| `~/.gemini/config/skills/hindsight-coding-agent` | the companion skill                                               |

Each file is backed up once to `<path>.hindsight-backup` before it is first rewritten.

On a fresh machine the installer can also seed the config file, without ever overwriting a field it
already sets:

```bash
node ./bin/install.js --server cloud --api-token <token>
node ./bin/install.js --server self-hosted --api-url http://localhost:8888
node ./bin/install.js --server daemon
```

### Option 3: Upstream's own installer

```bash
npx @vectorize-io/hindsight-coding-agents install agy
```

Upstream writes the **same entries under the same marker**, so the two routes replace each other
rather than doubling up — pick whichever you prefer, and re-running either one is safe.

---

## What happens automatically

Nothing below needs a command.

- **One memory bank per repository.** The default `bankIdTemplate` is `coding-agent::{gitProject}`,
  so every coding agent you run against a repo — Antigravity included — shares one bank, and linked
  worktrees resolve to the main checkout's bank.
- **Seeding on first open.** A cold bank is seeded from recent commit messages plus a read-only
  codebase survey of the repo's structure.
- **Background top-ups each session start.** New commits and new conversations are folded in by the
  runtime's ingestion engine, which does only the missing work.
- **5 maintained knowledge pages** — architecture, conventions, in-flight initiatives and the like —
  kept current on their own schedule.
- **One deep `reflect` synthesis** injected on a session's first prompt.
- **Transcript write-back at session end**, so the conversation is retained without anyone saving it.

---

## Configuration

Configuration is **one JSON file**: `~/.hindsight/coding-agent.json`. `HINDSIGHT_CONFIG` relocates
it. This plugin does not read or write a config file of its own, and there is deliberately no
repo-carried config.

Layering, later wins per field:

1. built-in defaults
2. environment variables — `HINDSIGHT_API_URL`, `HINDSIGHT_API_TOKEN`, and one per scalar setting
   (`HINDSIGHT_<FIELD_IN_CAPS>`)
3. the file's top level
4. `harnesses.<name>` — for Antigravity that section is `harnesses.antigravity-cli`
5. `banks.<resolvedBankId>` — per-repo, applied after the bank is resolved

Environment variables are a **fallback**: the file wins wherever it sets a value.

Each hook is its own short-lived process, so an edit to the file lands on your **next prompt**.
`apiToken` is the exception — it is re-read whenever the server rejects a request, so rotating a key
needs no restart.

### Where memory lives

| `serverMode`  | what runs                                 | needs                                     |
| ------------- | ----------------------------------------- | ----------------------------------------- |
| `cloud`       | Hindsight Cloud (default)                 | an API token                              |
| `self-hosted` | a Hindsight server you already run        | its `apiUrl`                              |
| `daemon`      | a local `hindsight-embed` on this machine | `uv` on PATH + an LLM key for extraction  |

In `daemon` mode the runtime starts `hindsight-embed` on `127.0.0.1:9077` (`apiPort`) and adopts a
server already on the port rather than restarting it. The first cold start downloads the daemon and
loads models, which takes longer than a hook may run, so it happens in the background: a session
that starts first simply has no memory for a turn or two.

### Settings you actually reach for

```jsonc
{
  "serverMode": "cloud",
  "apiToken": "…",
  "bankIdTemplate": "coding-agent::{gitProject}", // one bank per repo (default)
  "harnesses": {
    "antigravity-cli": { "reflectTimeoutMs": 60000 },
  },
  "banks": {
    "coding-agent::secret-client": { "disabled": true }, // no memory for this repo at all
    "coding-agent::big-mono": { "gitIngest": "full" },
  },
}
```

| field              | default                        | meaning                                                                       |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------- |
| `apiUrl`           | Hindsight Cloud                | API base URL; set it for a self-hosted server                                  |
| `apiToken`         | —                              | bearer token; re-read on rejection, so rotation needs no restart               |
| `bankIdTemplate`   | `"coding-agent::{gitProject}"` | dynamic bank id; `{harness}`, `{project}` and `{gitProject}` are available     |
| `mapPathToBank`    | —                              | absolute path → bank, longest prefix wins                                      |
| `banks.<bankId>`   | —                              | per-repo override of any behavioural field, keyed by the resolved bank id      |
| `disabled`         | `false`                        | hard off-switch — globally, per harness, or per bank                           |
| `optInOnly`        | `false`                        | remember nothing except under `optInPaths`                                     |
| `gitIngest`        | `"message"`                    | `"message"` \| `"full"` (messages + per-commit diffs) \| `"none"`              |
| `autoReflect`      | `true`                         | inject the session-start reflect; `false` makes reflect tool-only              |
| `retainSessions`   | `true`                         | session write-back at `Stop`                                                   |
| `logLevel`         | `"info"`                       | verbosity of `~/.hindsight/coding-agents-logs/plugin.log`                      |

The full reference — opt-in policy, knowledge-page refresh cadence, observation scopes, daemon
settings, provenance tags — lives in
[upstream's README](https://github.com/vectorize-io/hindsight). Do not take settings from anywhere
else; this plugin invents none.

---

## MCP tools

The stdio MCP server registered as `hindsight` is the runtime's, started with
`HINDSIGHT_MCP_HARNESS=antigravity-cli`:

| tool                              | use                                                                  |
| --------------------------------- | -------------------------------------------------------------------- |
| `hindsight_search_knowledge_pages` | first stop for project questions — fast server-side hybrid search    |
| `hindsight_read_knowledge_page`    | read one page in full                                                |
| `hindsight_list_knowledge_pages`   | the page roster for this bank                                        |
| `hindsight_reflect`                | deep synthesis over the whole memory; slower, use deliberately       |
| `hindsight_ingest_document`        | store an external document, durable finding, or a correction         |
| `hindsight_capture_initiative`     | record an agreed plan, and update it via `relates_to_page_id`        |
| `hindsight_diagnose`               | what the config file says vs. what the running client is using       |
| `hindsight_sync_status`            | is the seeded memory queryable yet (`"synced": true`)                |

---

## How a turn flows

1. **`PreInvocation`** (`bin/pre-invocation.js` → `src/hooks/pre-invocation.ts`). Antigravity sends
   `workspacePaths[]`, `conversationId` and `transcriptPath` on stdin — there is no prompt field, so
   the runtime recovers the last user turn from the transcript JSONL itself. It resolves the bank,
   reflects or searches knowledge pages, and replies
   `{"injectSteps":[{"ephemeralMessage":"…"}]}`. This is Antigravity's only injection point, so it
   also carries the session-start work other harnesses do in a `SessionStart` hook.
2. **The turn runs.** The agent has the injected memory in context, the rules in `rules/AGENTS.md`,
   the companion skill, and the `hindsight_*` tools.
3. **`Stop`** (`bin/stop-hook.js` → `src/hooks/stop-hook.ts`). Antigravity sends `conversationId`,
   `transcriptPath` and `workspacePaths`; the runtime writes the transcript back into the bank and
   the hook replies `{}`.
4. **Status line** (`bin/statusline.js`) prints `Hindsight · <bank>`.

Every hook is fail-safe: if the runtime cannot be started at all, the wrapper writes the event's
neutral reply (`{"injectSteps":[]}` or `{}`), logs the reason to stderr and exits zero. The status
line prints nothing rather than an error. Memory is best-effort; the session is not.

---

## Development

```bash
bun install      # dependencies
bun run build    # tsup: src/ -> dist/
bun test         # unit tests
bun run lint     # tsc --noEmit
```

To dogfood a change in your own Antigravity: `bun run build`, then `node ./bin/install.js`.

---

## Uninstall

```bash
node ./bin/install.js uninstall
```

Removes exactly what the installer added — the hook group, the MCP server entry, the status line
(restoring a custom one it preserved) and the installed skill — and leaves everything else in those
files alone. Your memory itself lives in the bank on the server, not on disk; to reset a repo's
memory, delete its bank.

---

## Upgrading from 1.x

1.x shipped a custom Hindsight client with its own recall/retain pipeline, mental models, three bank
scoping modes and an eight-tool MCP server. All of it is gone, replaced by the upstream runtime.

- **Old settings are not translated.** `bankScope`, `bankId`, a `bankIdTemplate` using `{project}`,
  `apiKey`, `mentalModelsEnabled`, `recallBudget` and the rest described a pipeline this runtime
  replaced, and reinterpreting them would be guesswork. `.hindsight.json`,
  `hindsight.config.json` and `~/.hindsight/config` are no longer read at all — configure
  `~/.hindsight/coding-agent.json` instead.
- **Bank naming changes.** Memory is now one bank per repo, `coding-agent::{gitProject}`, shared by
  every coding agent you run there. To reproduce the old per-agent naming:
  ```jsonc
  { "bankIdTemplate": "{harness}::{gitProject}" }
  ```
- **Tools change.** `hindsight_recall`, `hindsight_retain`, `hindsight_status` and every
  `*_mental_model` tool no longer exist. See the table above for what replaces them:
  `hindsight_search_knowledge_pages` and `hindsight_reflect` for retrieval,
  `hindsight_ingest_document` and `hindsight_capture_initiative` for writing.
- **Injection changes.** Memory now arrives as an ephemeral message before the turn, not as
  `<hindsight_mental_models>` / `<hindsight_recalled_memories>` blocks.
- **Re-run the installer** after upgrading so the hook, MCP and status-line entries point at the new
  wrappers.

---

## Links

- Hindsight: <https://hindsight.vectorize.io>
- Upstream runtime: <https://github.com/vectorize-io/hindsight>

## License

MIT
