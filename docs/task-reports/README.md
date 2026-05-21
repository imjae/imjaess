# Task Reports

This folder is for Markdown task reports that are safe to commit and optionally mirror to Notion.

## Purpose

Commit these reports when task history should travel with the repository. They are the shareable record of task intent, role summaries, broker artifacts, verifier decisions, and final status.

Do not commit the live SQLite database just to share task history.

## Suggested Filename

Use a stable date and short slug:

```text
YYYY-MM-DD-task-title.md
```

Example:

```text
2026-05-21-add-notion-sync.md
```

## What To Include

- Task title and goal.
- Target project name, not a private absolute path unless needed.
- Agent role summary.
- Broker artifacts:
  - `evidence_pack`
  - `implementation_brief`
  - `test_result`
  - `final_brief`
- Verifier decision.
- Verification commands and exit codes.
- Human follow-up notes.

## What To Exclude

- API keys or tokens.
- `.env.local` contents.
- Full raw shell logs with sensitive local paths.
- Full raw agent logs if they contain private context.
- `.data/harness.sqlite` contents.
- `.harness/` worktree contents.
