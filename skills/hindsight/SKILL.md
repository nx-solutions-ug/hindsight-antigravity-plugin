---
name: hindsight
description: Manage Hindsight long-term memory, inspect mental models, search recalled facts, and configure bank settings for Antigravity.
---

# Hindsight Persistent Memory Skill

Use this skill to inspect, query, and manage Hindsight memory banks and mental models in Antigravity.

## Configuration Overview

Hindsight connects using the following configuration sources (in priority order):

1. **Workspace Config**: `.hindsight.json` or `hindsight.config.json` in the project root:
   ```json
   {
     "apiUrl": "https://api.refz.link",
     "apiKey": "your-api-key",
     "bankId": "my-project-bank",
     "autoRecall": true,
     "autoRetain": true,
     "mentalModelsEnabled": true
   }
   ```
2. **Environment Variables**:
   - `HINDSIGHT_API_URL`
   - `HINDSIGHT_API_KEY` (or `HINDSIGHT_API_TOKEN`)
   - `HINDSIGHT_BANK_ID`
3. **Global Config**: `~/.hindsight/config` (INI format) or `~/.hindsight/coding-agent.json`:
   ```ini
   api_url = "https://api.refz.link"
   api_key = "your-api-key"
   bank_id = "my-shared-bank"
   ```
4. **Auto-derived Bank ID**: If no bank is specified, the plugin automatically derives the bank ID from your Git repository or workspace folder name.

---

## Bank Scoping Modes

Choose how memories and mental models are partitioned:

| Mode | Behavior | Best Used For |
| :--- | :--- | :--- |
| **`per-project-tagged`** | Memories and mental models are stored in a shared bank (e.g. `pi-memory`), but tagged with `project:<name>`. Recall and mental model injection are filtered to this tag. | Teams sharing a central bank who want per-project partition. |
| **`per-project`** | Each project has its own dedicated bank in Hindsight (e.g. `pi-memory-{project}` or `{project}`). | Strongest isolation; each repository has an independent memory bank. |
| **`global`** | All memories and mental models are stored in the bank without project tags or filters. | General-purpose personal memory across all workspaces. |

Configure via:
- `bankScope`: `"per-project-tagged" | "per-project" | "global"` in `.hindsight.json`
- `HINDSIGHT_BANK_SCOPE`: environment variable override
- `HINDSIGHT_PROJECT_NAME`: custom project identifier override
- `HINDSIGHT_BANK_ID_TEMPLATE`: template such as `"pi-memory-{project}"` for `per-project` mode

---

## Mental Models

Mental models are persistent, living syntheses of project conventions, architecture, and user preferences.

### How they work:
- The plugin automatically fetches mental models for your configured bank and injects them into the system prompt at the start of each turn (`PreInvocation` hook).
- You can inspect all active mental models with `hindsight_list_mental_models`.
- You can create a new mental model with `hindsight_create_mental_model`:
  ```json
  {
    "name": "Testing Guidelines",
    "source_query": "What are the testing conventions, test runners, and mock libraries used in this project?"
  }
  ```
- When codebase conventions change, refresh a model with `hindsight_refresh_mental_model`.

---

## Automatic Recall

- When the user asks questions or mentions specific topics, the plugin automatically performs semantic search against your Hindsight bank.
- Recalled facts are injected into context before the model generates a response.
- Ground answers using:
  ```markdown
  > 🧠 **From Hindsight memory** — <fact>
  ```

---

## Autolearning / Auto-Retain

- After each conversation session completes, the `Stop` hook automatically parses conversation turns and submits them to the Hindsight background extraction pipeline.
- The server extracts structured facts, temporal relationships, and entities into your memory bank without blocking interaction.
