# Hindsight Antigravity Plugin

An official plugin for **Google Antigravity** integrating **Hindsight** persistent long-term agent memory.

The plugin enables Antigravity to:
1. **Connect to any Hindsight memory bank** via flexible configuration (workspace config, global config, environment variables, or automatic repository derivation).
2. **Inject Mental Models into the System Prompt**: Automatically fetches living mental models (architecture, coding conventions, domain rules) from the configured bank and injects them into the prompt before every turn (`PreInvocation` hook).
3. **Automatic Topic Recall**: Semantically searches the memory bank based on the user's prompt topic and injects relevant historical facts and past decisions into context.
4. **Autolearn & Auto-Retain**: Asynchronously retains conversations at the end of each session (`Stop` hook) with automatic turn deduplication and synthetic tag stripping.
5. **Model Context Protocol (MCP) Server**: Exposes 8 dedicated tools for on-demand memory recall, retention, reflection, and mental model management.
6. **Agent Rules & Skills**: Comes with pre-configured rules (`rules/AGENTS.md`) and an interactive management skill (`skills/hindsight/SKILL.md`).

---

## Plugin Architecture

```text
hindsight-antigravity-plugin/
├── plugin.json                 # Antigravity plugin manifest
├── hooks.json                  # Lifecycle hooks (PreInvocation, Stop)
├── mcp_config.json             # Stdio MCP server registration
├── rules/
│   └── AGENTS.md               # Contextual agent rules for memory citation & usage
├── skills/
│   └── hindsight/
│       └── SKILL.md            # Interactive skill for explicit memory operations
├── src/
│   ├── config.ts               # Multi-tiered configuration resolver
│   ├── client.ts               # Robust Hindsight REST client
│   ├── mental-models.ts        # Mental models fetcher, cache, and prompt injector
│   ├── recall.ts               # Semantic topic recall engine
│   ├── retain.ts               # Transcript parser, tag cleaner & auto-retain batcher
│   ├── hooks/
│   │   ├── pre-invocation.ts   # PreInvocation hook (injects mental models + recall)
│   │   └── stop-hook.ts        # Stop hook (retains conversation turns)
│   ├── mcp/
│   │   └── server.ts           # Stdio MCP Server (8 tools)
│   └── installer.ts            # One-step installer
├── bin/
│   ├── pre-invocation.js       # PreInvocation hook CLI binary
│   ├── stop-hook.js            # Stop hook CLI binary
│   ├── mcp-server.js           # MCP server CLI binary
│   └── install.js              # Plugin installation script
└── test/                       # Comprehensive test suite (14 tests)
```

---

## Installation

### Option 1: Install via Bun / NPM (Global)

Install the package globally via Bun or NPM:

```bash
bun add -g @chronova/hindsight-antigravity-plugin
# or
npm install -g @chronova/hindsight-antigravity-plugin
```

Then run the installer to set up the plugin in Antigravity:

```bash
hindsight-antigravity-install
```

### Option 2: Run via Bunx / Npx directly

```bash
bunx @chronova/hindsight-antigravity-plugin install
```

### Option 3: Local Repository Installation

From the cloned repository:

```bash
bun install
bun run build
node ./bin/install.js          # Global to ~/.gemini/config/plugins/hindsight
node ./bin/install.js --local  # Local to .agents/plugins/hindsight
```

---

## Configuration

The plugin resolves configuration using the following priority order:

### 1. Workspace Configuration (Highest Priority)
Create a `.hindsight.json` or `hindsight.config.json` in your project root:

```json
{
  "apiUrl": "https://api.refz.link",
  "apiKey": "your-api-key",
  "bankId": "my-project-bank",
  "autoRecall": true,
  "autoRetain": true,
  "mentalModelsEnabled": true,
  "recallBudget": "mid"
}
```

### 2. Environment Variables & Scoping Options
You can specify credentials and bank scoping parameters via environment variables or workspace config:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `HINDSIGHT_API_URL` | Hindsight server endpoint | `https://api.refz.link` |
| `HINDSIGHT_API_KEY` | Bearer authentication key | *(optional)* |
| `HINDSIGHT_BANK_ID` | Memory bank identifier | Auto-derived from Git/folder |
| `HINDSIGHT_BANK_SCOPE` | Bank scoping mode: `per-project-tagged`, `per-project`, `global` | `per-project-tagged` (if shared bank set), else `per-project` |
| `HINDSIGHT_PROJECT_NAME` | Project name override (used for tags and bank names) | Auto-derived from Git root or folder |
| `HINDSIGHT_PROJECT_TAG_PREFIX` | Prefix for project tags (e.g. `project:`) | `project:` |
| `HINDSIGHT_BANK_ID_TEMPLATE` | Bank template for `per-project` mode (e.g. `pi-memory-{project}`) | *(optional)* |
| `HINDSIGHT_AUTO_RECALL` | Enable automatic recall on user prompts (`true`/`false`) | `true` |
| `HINDSIGHT_AUTO_RETAIN` | Enable autolearning on conversation end (`true`/`false`) | `true` |
| `HINDSIGHT_MENTAL_MODELS`| Enable automatic mental models injection (`true`/`false`)| `true` |
| `HINDSIGHT_RECALL_BUDGET`| Recall computation depth (`low`, `mid`, `high`) | `mid` |

---

## Bank Scoping Modes

Hindsight memories and mental models can be scoped in three distinct ways:

### 1. `per-project-tagged` (Shared Bank, Scoped by Project Tag)
All projects share a single bank (e.g. `pi-memory`), but each project's data is isolated via tags:
- **Retain**: Every retained conversation is tagged with `project:<project-name>`.
- **Recall**: Semantic memory recall automatically filters by `tags: ["project:<project-name>"]`.
- **Mental Models**: Only mental models tagged with `project:<project-name>` are fetched and injected.
- *Best for*: Central team banks where multiple codebases reside in the same Hindsight bank.

```json
{
  "bankId": "pi-memory",
  "bankScope": "per-project-tagged"
}
```

### 2. `per-project` (Dedicated Bank Per Project)
Each project has its own dedicated memory bank in Hindsight:
- **Direct Mode**: Bank ID equals the project name (e.g. `my-repo-name`).
- **Template Mode**: Use `bankIdTemplate: "pi-memory-{project}"` to generate e.g. `pi-memory-my-repo-name`.
- *Best for*: Strict isolation where each repository has an independent memory store.

```json
{
  "bankScope": "per-project",
  "bankIdTemplate": "pi-memory-{project}"
}
```

### 3. `global` (Shared Unscoped Bank)
All conversations and mental models share the specified bank without project tags or filters:
- *Best for*: Personal assistants or monolithic projects where all memories apply globally.

```json
{
  "bankId": "hermes",
  "bankScope": "global"
}
```

---

### 3. Global Hindsight Config (`~/.hindsight/config`)
The plugin automatically reads your existing Hindsight CLI config file (`~/.hindsight/config`):

```ini
api_url = "https://api.refz.link"
api_key = "your-api-key"
bank_id = "my-shared-bank"
```

### 4. Automatic Project and Bank ID Fallback
If no `projectName` or `bankId` is explicitly defined, the plugin automatically derives a clean, sanitized identifier from your Git repository or workspace folder (e.g. `my-awesome-repo`).

---

## How It Works in Antigravity

### 1. PreInvocation Hook
Before the model generates a response, Antigravity fires the `PreInvocation` hook:
- Fetches active **Mental Models** from Hindsight (cached with TTL) and injects:
  ```markdown
  <hindsight_mental_models bank="my-bank">
  #### Mental Model: Coding Standards (coding-standards)
  - Use TypeScript strict mode
  - Follow modular patterns
  </hindsight_mental_models>
  ```
- Parses the user's latest prompt, triggers semantic recall, and injects:
  ```markdown
  <hindsight_recalled_memories bank="my-bank" topic="auth service">
  - Auth service requires TEST_DATABASE_URL on CI
  - Tokens expire after 15 minutes
  </hindsight_recalled_memories>
  ```

### 2. Stop Hook
When the execution loop finishes, Antigravity fires the `Stop` hook:
- Reads the session JSONL transcript from `transcriptPath`.
- Strips any prior synthetic memory tags.
- Verifies session watermarks to only retain uncommitted conversation turns.
- Posts turns asynchronously (`async: true`) to the Hindsight ingestion pipeline.

### 3. MCP Tools
The plugin includes a full Model Context Protocol server exposing:
- `hindsight_recall(query, budget, max_tokens, tags)`: Query memories.
- `hindsight_retain(content, context, tags)`: Explicitly store high-value knowledge.
- `hindsight_list_mental_models()`: List living project documents.
- `hindsight_get_mental_model(mental_model_id)`: Retrieve full mental model contents.
- `hindsight_create_mental_model(name, source_query)`: Define a new mental model.
- `hindsight_refresh_mental_model(mental_model_id)`: Trigger re-synthesis against latest memories.
- `hindsight_reflect(query, budget)`: Deep historical reasoning synthesis.
- `hindsight_status()`: Diagnostic status of server and memory bank.

---

## Development & Testing

```bash
# Install dependencies
bun install

# Build TypeScript to dist/ and bin/
bun run build

# Run unit tests (18 tests)
bun test

# Type check
bun run lint
```

## License

MIT
