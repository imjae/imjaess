# CONVENTIONS.md

This document records conventions for the harness itself. Project-specific Unity conventions can be exported into the target project's own `CONVENTIONS.md`.

## Stack

- Use TypeScript across the app.
- Use Next.js App Router for UI and API routes.
- Use SQLite through the local database helper in `lib/db.ts`.
- Keep long-running agent work out of direct web request handling.
- Use Node worker-side tools for local shell access.

## Data Ownership

- SQLite is local runtime state, not source-controlled project state.
- Git-tracked task history should be stored as sanitized Markdown reports under `docs/task-reports/`.
- Notion task pages should be generated from the same report shape as local Markdown exports.
- Do not duplicate raw agent logs into committed documents unless they are intentionally redacted.

## Agent Flow

- Keep the role sequence as `researcher -> implementer -> tester -> verifier`.
- The broker is the only handoff path between roles.
- Each role should receive only the minimum context needed for its job.
- Verification decisions must use `pass`, `needs_fix`, or `blocked`.
- Default retry limit is 3 rounds unless changed through configuration.

## UI

- The first screen should remain the operational dashboard.
- Settings that affect future task runs belong in the Settings modal.
- Avoid marketing-style landing pages.
- Keep logs, broker artifacts, shell evidence, verifier decisions, and Unity rules visually separated.
- Text must remain readable at narrow widths without overlapping.

## Shell And Worktrees

- One task should map to one isolated task workspace.
- If the target project is a git repository, prefer a git worktree under `.harness/worktrees/`.
- Shell logs must include command, cwd, stdout, stderr, exit code, duration, task, and agent role.
- Commands should default to the task workspace.

## Documentation

- Use `AGENTS.md` for machine/agent operating rules.
- Use `CONVENTIONS.md` for human-readable engineering conventions.
- Use `docs/PROJECT_HANDOFF_CHECKLIST.md` for setup and handoff steps.
- Use `docs/task-reports/` for committed task summaries.
