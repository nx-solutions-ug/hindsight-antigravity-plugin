# Hindsight Memory & Mental Models Rules

You are integrated with **Hindsight**, an AI agent memory system providing persistent, long-term memory across sessions.

## 1. Mental Models (`<hindsight_mental_models>`)

- The active bank's **Mental Models** are automatically fetched and injected into your prompt before every turn.
- Mental models represent living synthesis: established coding standards, architectural decisions, and project conventions.
- **Rule**: Follow the conventions established in active mental models. If a user instruction or codebase update supersedes a mental model, follow the current codebase and suggest refreshing the mental model using `hindsight_refresh_mental_model`.

## 2. Topic Recall (`<hindsight_recalled_memories>`)

- Relevant facts, historical decisions, and past bug fixes are automatically recalled based on the user's prompt topic.
- **Attribution**: When your response relies on recalled memory, visibly attribute it using the standard callout format:
  ```markdown
  > 🧠 **From Hindsight memory** — <specific fact or convention drawn on>
  ```
- **Verification**: Always verify recalled memory against current project source code before applying changes, especially if code may have evolved since the memory was formed.

## 3. Bank Scoping Modes

Hindsight memories and mental models operate under one of three scoping modes:
- **`per-project-tagged`**: Memories are kept in a shared bank (e.g. `pi-memory`), but tagged with `project:<name>`. Recalled facts and mental models are scoped to the current project's tag.
- **`per-project`**: The project has its own dedicated bank (e.g. `<project>` or `pi-memory-<project>`).
- **`global`**: Shared unpartitioned memory bank across projects.

## 4. Autolearning / Auto-Retain

- Conversations are automatically retained in the background at the end of each session. In `per-project-tagged` mode, dialogue turns are automatically tagged with the current project tag.
- You do not need to manually retain ordinary conversation turns.
- **Proactive manual retain**: Use `hindsight_retain` when you or the user establish a critical new project decision, an architectural convention, or solve a tricky bug that future sessions must know immediately.

## 5. MCP Tools Reference

When deep reasoning or manual operations are required, use the provided MCP tools:
- `hindsight_recall(query, budget, tags)`: Query specific past learnings on-demand.
- `hindsight_retain(content, context, tags)`: Explicitly persist high-value knowledge.
- `hindsight_list_mental_models()`: Discover living documents for this project.
- `hindsight_get_mental_model(mental_model_id)`: Read full details of a specific mental model.
- `hindsight_create_mental_model(name, source_query)`: Create a new living reflection.
- `hindsight_refresh_mental_model(mental_model_id)`: Trigger re-synthesis of a mental model.
- `hindsight_reflect(query)`: Deep reasoning over historical facts.
- `hindsight_status()`: Verify connection and bank status.
