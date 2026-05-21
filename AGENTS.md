# AGENTS.md

This repository is a localhost-only multi-agent harness. Agents working here should preserve the context-isolated execution model and avoid committing local runtime state.

## Project Goal

- Provide a web UI for creating tasks.
- Run Codex-style roles through `researcher -> implementer -> tester -> verifier`.
- Keep role contexts isolated through broker artifacts instead of sharing raw agent logs.
- Execute shell commands only from the local Node worker, scoped to a task workspace.
- Store runtime state in SQLite locally, while sharing selected Markdown reports through git and Notion.

## Agent Roles

- `researcher`: gather facts and constraints. Do not edit implementation files unless explicitly asked.
- `implementer`: make scoped code changes from the broker evidence pack.
- `tester`: validate the implementation from the broker implementation brief and command evidence.
- `verifier`: decide `pass`, `needs_fix`, or `blocked` from broker artifacts and verification output.

The `scripter` role is intentionally excluded from this MVP.

## Context Isolation Rules

- Do not pass raw output from one role directly to another role.
- Use broker artifacts for handoff:
  - `evidence_pack`
  - `implementation_brief`
  - `test_result`
  - `final_brief`
- Keep handoff text compact and evidence-based.
- Treat shell logs as audit evidence, not as a free-form shared memory dump.

## Files That Should Be Committed

- Source code under `app/`, `lib/`, and `tests/`.
- `README.md`.
- `AGENTS.md`.
- `CONVENTIONS.md`.
- `docs/PROJECT_HANDOFF_CHECKLIST.md`.
- Sanitized task reports under `docs/task-reports/`.
- `.env.example`.

## Files That Should Not Be Committed

- `.env`, `.env.local`, or any other secret-bearing env file.
- `.data/` and SQLite runtime databases.
- `.harness/` task worktrees.
- `node_modules/`.
- `.next/`.
- Raw shell logs or raw agent logs unless intentionally redacted into a report.

## Verification Commands

For this harness:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

For Unity target projects, use the project-specific verification command from the task. A common Deluge-like default is:

```powershell
dotnet build Deluge.sln --no-restore
```

## Security Notes

- The browser must never execute shell commands directly.
- Shell execution belongs to the server-side worker only.
- Work should stay inside the task workspace unless a user explicitly changes the scope.
- Do not put API keys, Notion tokens, absolute private paths, or user-specific credentials into committed reports.
