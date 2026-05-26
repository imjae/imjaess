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

Task verification mode controls whether the tester agent runs:

- `fast`: `researcher -> implementer -> verifier`; default for new tasks.
- `balanced`: `researcher -> implementer -> tester -> verifier`; use when independent tester review is worth the extra time.

Task planning mode controls whether the planner agent pauses for user answers:

- `direct`: `researcher -> implementer`; default for new tasks.
- `plan`: `researcher -> planner -> waiting_for_user`; the web UI collects the user's answer, then the worker resumes with a broker `plan_brief`.

Do not count user waiting time against an agent slice time budget. The planner agent may ask questions, but implementation must wait until the broker has a user answer.

New tasks do not run a shell verification command by default. Use the project-specific verification command from the task only when the user explicitly configured one.

For isolated Unity worktrees, generated `.sln` / `.csproj` files may be copied into the tester worktree and temporarily patched for added or removed `.cs` files only when the configured command is a `dotnet build ... .sln` command. Treat prefab, scene, and `.asset` edits as requiring static diff review plus manual Unity editor confirmation.

## Security Notes

- The browser must never execute shell commands directly.
- Shell execution belongs to the server-side worker only.
- Work should stay inside the task workspace unless a user explicitly changes the scope.
- Do not put API keys, Notion tokens, absolute private paths, or user-specific credentials into committed reports.
