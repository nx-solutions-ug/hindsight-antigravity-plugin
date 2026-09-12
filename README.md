# Hindsight Antigravity Plugin

Long-term project memory for the **Google Antigravity desktop application** — the app you launch and
open a workspace in, whose state lives in `~/.gemini/antigravity` — backed by
[Hindsight](https://hindsight.vectorize.io).

This package wires [`@vectorize-io/hindsight-coding-agents`](https://github.com/vectorize-io/hindsight)
into the app's lifecycle hooks, its MCP server list and a namespaced plugin bundle, and implements no
memory logic of its own. Everything about how memory is recalled, retained, scoped to a bank and
configured belongs to the runtime; this plugin's job is wiring, fail-safe delegation and packaging.

> **Not for `agy`.** If you want memory in the Antigravity **CLI**, use upstream's own installer —
> `npx @vectorize-io/hindsight-coding-agents install agy` — which wires the same runtime into the
> TUI, including a status line and `~/.gemini/antigravity-cli/settings.json`. This plugin never
> writes to the CLI's tree. The two share one memory bank per repository, so running both is fine.

There is **no setup command and no ingest command**. Open a workspace in Antigravity and the memory
for that repo builds itself in the background.

---

## Installation

```bash
npm i -g @chronova/hindsight-antigravity-plugin
hindsight-antigravity-install
```

…or from a checkout: `bun install && bun run build && node ./bin/install.js`.

Then **restart the Antigravity app**.

### What the installer writes

| path                                               | what is added                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `~/.gemini/config/hooks.json`                      | the `PreInvocation` and `Stop` hooks, grouped under `coding-agents`    |
| `~/.gemini/antigravity/mcp_config.json`            | `mcpServers.hindsight` — the app's own MCP registry                    |
| `~/.gemini/config/plugins/hindsight/plugin.json`   | the plugin manifest that makes the bundle discoverable                 |
| `~/.gemini/config/plugins/hindsight/skills/…`      | the companion skill                                                    |
| `~/.gemini/config/plugins/hindsight/rules/…`       | the always-on memory rules                                             |

Three targets rather than one, because Antigravity splits them that way:

- **Hooks** are host-wide. `~/.gemini/config/hooks.json` is the global hooks file every Antigravity
  flavour reads — the app, the IDE and the CLI. The app has no hooks file of its own.
- **MCP** is per product. `~/.gemini/antigravity/mcp_config.json` is the file the app's
  *Settings → Customizations → Open MCP Config* button opens, and the one its MCP server list reads.
- **Skills and rules** ride in a **plugin bundle**, the app's native way to package them.

The bundle deliberately contains **no `hooks.json` and no `mcp_config.json`**, even though the plugin
format allows both: a plugin-level copy would be a *second* registration of the same command, and two
`PreInvocation` entries inject memory twice and retain the turn twice. Anything that spawns a process
is registered exactly once, at host level.

Commands are written as **absolute paths**. Antigravity expands no placeholder in these files (not
even `${workspaceFolder}`), so a template would be spawned verbatim and fail.

Each file is backed up once to `<path>.hindsight-backup` before it is first rewritten, and foreign
entries — your own hooks, someone else's MCP servers — are never touched.

#### If the app does not pick the server up

Antigravity 2.x also reads a shared `~/.gemini/config/mcp_config.json` across the app, the IDE, the
CLI and the SDK. That file is **opt-in** here, because a host that reads both would list `hindsight`
twice:

```bash
node ./bin/install.js --shared-mcp
```

Uninstall cleans both files regardless of how you installed.

### Seeding the server on a fresh machine

The installer can also seed `~/.hindsight/coding-agent.json`, without ever overwriting a field it
already sets:

```bash
node ./bin/install.js --server cloud --api-token <token>
node ./bin/install.js --server self-hosted --api-url http://localhost:8888
node ./bin/install.js --server daemon
```

---

## What happens automatically

Nothing below needs a command.

- **One memory bank per repository.** The default `bankIdTemplate` is `coding-agent::{gitProject}`,
  so every coding agent you run against a repo — the Antigravity app and `agy` included — shares one
  bank, and linked worktrees resolve to the main checkout's bank.
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
4. `harnesses.<name>` — `harnesses.antigravity-cli`, which is the runtime's id for its Antigravity
   integration and covers the app as well as the CLI (see [Harness naming](#harness-naming))
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
`HINDSIGHT_MCP_HARNESS=antigravity-cli` — see [Harness naming](#harness-naming) for why that value
is not `antigravity`:

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

Every hook is fail-safe: if the runtime cannot be started at all, the wrapper writes the event's
neutral reply (`{"injectSteps":[]}` or `{}`), logs the reason to stderr and exits zero. Memory is
best-effort; the session is not.

There is no status-line wrapper. The `Hindsight · <bank>` indicator is a feature of the CLI's TUI,
rendered from `~/.gemini/antigravity-cli/settings.json`; the desktop app draws its own chrome and has
nothing to render a command's stdout into. `hindsight_diagnose` reports the resolved bank instead.

---

## Harness naming

The runtime stamps everything it retains with a harness id, and for Antigravity that id is
**`antigravity-cli`** — including in the app.

That is upstream's name for its Antigravity *integration*, not a claim about which surface is
running: `dist/antigravity-hook.js` and `dist/antigravity-stop-hook.js` call
`runHarnessPrompt("antigravity-cli")` with no way to override it. The id selects the
`harnesses.<id>` config section and feeds `{harness}` in `bankIdTemplate`, so the MCP server has to
be given the same one. Setting `HINDSIGHT_MCP_HARNESS=antigravity` would point the `hindsight_*`
tools at a different config section — and possibly a different bank — than the memory being recalled
and retained around them.

The app and the CLI speak the same hook protocol (same `hooks.json` shape, same
`PreInvocation`/`Stop` events, same `workspacePaths` / `conversationId` / `transcriptPath` payload),
so one runtime harness correctly serves both. Only the installation differs — which is the whole of
what this plugin does differently from `install agy`.

---

## Development

```bash
bun install      # dependencies
bun run build    # tsup: src/ -> dist/
bun test         # unit tests
bun run lint     # tsc --noEmit
```

To dogfood a change in your own Antigravity: `bun run build`, then `node ./bin/install.js`, then
restart the app. The installer points the host at this checkout's `bin/`, so subsequent rebuilds need
no reinstall — only a restart.

---

## Uninstall

```bash
node ./bin/install.js uninstall
```

Removes exactly what the installer added — the hook group, the MCP server entry in both registries,
and the plugin bundle — and leaves everything else in those files alone. A plugin directory whose
`plugin.json` is not ours is left in place. Your memory itself lives in the bank on the server, not
on disk; to reset a repo's memory, delete its bank.

---

## Upgrading from 2.x

2.x was rewritten against upstream's `antigravity-cli` harness and installed like `agy`: it wrote the
MCP server to the shared `~/.gemini/config/mcp_config.json`, enabled a status line in
`~/.gemini/antigravity-cli/settings.json`, dropped the skill into `~/.gemini/config/skills/`, and
shipped no plugin bundle at all. None of that is how the desktop app is extended.

Run `node ./bin/install.js` after upgrading. Then, if you installed 2.x, clean up what it left
behind — the new uninstaller does not know about paths this version never writes:

```bash
# the CLI status line 2.x enabled for an app that has none
#   remove the "statusLine" key from ~/.gemini/antigravity-cli/settings.json
# the skill 2.x copied outside any plugin bundle
rm -rf ~/.gemini/config/skills/hindsight-coding-agent
```

The `hindsight` entry in `~/.gemini/config/mcp_config.json` needs no action: this version's
uninstaller clears it, and leaving it alongside the app registry only risks a duplicate listing —
remove it if the app shows `hindsight` twice.

Nothing about your memory changes: same runtime, same harness id, same bank, same tools.

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
- **Re-run the installer** after upgrading so the hook and MCP entries point at the new wrappers.
  1.x copied a plugin directory into `~/.gemini/config/plugins/hindsight`; this version writes its
  bundle to the same place, so that directory is replaced rather than left stale.

---

## Links

- Hindsight: <https://hindsight.vectorize.io>
- Upstream runtime: <https://github.com/vectorize-io/hindsight>

## License

MIT
