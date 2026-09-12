# Hindsight Memory Rules

You have long-term project memory through Hindsight. One bank per repository, built and maintained
automatically. These rules cost context on every turn — follow them, don't restate them.

## Injected memory

- Relevant memory arrives as an **ephemeral message before the turn**, injected by the
  `PreInvocation` hook. Treat it as context you already have, not as something the user said.
- **Cite it visibly** whenever it informs your answer, at the point it does:
  `🧠 From Hindsight memory (<page>): …`. Never credit memory that did not contribute.
- **Verify before acting.** Memory records what was true when it was written. Check the current
  source, config or git before you change anything on the strength of a recalled fact.

## Correcting the record

When the code, git, or another source contradicts something memory served, fix it — do not silently
ignore it. Call `hindsight_ingest_document` with title `Correction: <topic>` and content covering
(1) what memory claimed, (2) what is verifiably true now, (3) the evidence you checked, with exact
values quoted. Newer facts outrank older ones in retrieval, so one correction disarms the trap for
every future session.

## Capturing initiatives

- Call `hindsight_capture_initiative(title, summary)` once a plan is agreed and before code is
  written.
- Call it **again** when the plan materially changes — goal, scope or rationale, including
  mid-implementation — passing that initiative's page id as `relates_to_page_id` and summarising the
  current intent. Same page, updated plan; never a second page. Trivial course-corrections don't
  count.

## Retrieving

- `hindsight_search_knowledge_pages(query)` is the **first stop** for project questions — components,
  conventions, past decisions, initiatives. Fast.
- `hindsight_read_knowledge_page` / `hindsight_list_knowledge_pages` read pages in full.
- `hindsight_reflect(query)` is deep synthesis for WHY questions and exact decided values. It takes
  seconds — search the knowledge pages first and reflect only when they are too shallow.
- `hindsight_ingest_document` stores an external document or durable finding.
- `hindsight_diagnose` and `hindsight_sync_status` answer "is memory configured / ready yet".

## Retention

The conversation is retained automatically at session end by the `Stop` hook. Never save it by hand,
and never tell the user to.
