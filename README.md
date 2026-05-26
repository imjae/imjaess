# Local Multi-Agent Harness

Localhost-only MVP for running context-isolated Codex agents through a `Researcher -> Implementer -> Tester -> Verifier` loop.

## What It Does

- Creates local tasks from a web dashboard.
- Runs multiple tasks in parallel through an in-process Node worker queue.
- Creates isolated git worktrees per agent role and round when the target project is a git repository.
- Gives CLI access only to the server-side worker, never to the browser.
- Logs every shell command with cwd, stdout, stderr, exit code, duration, task, and agent role.
- Stores tasks, agent runs, verifier decisions, shell logs, projects, and Unity convention notes in SQLite.
- Records Unity convention notes and can export `AGENTS.md` plus `CONVENTIONS.md` into a selected project.

## Setup

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Open <http://127.0.0.1:3000>.

## Agent Modes

By default, `.env.example` sets `MOCK_AGENTS=1`, which exercises the queue, worktree, logging, and verifier flow without calling model APIs.

For real Codex/OpenAI calls:

```env
OPENAI_API_KEY=your_key
MOCK_AGENTS=0

RESEARCHER_PROVIDER=openai
RESEARCHER_MODEL=gpt-5.4
IMPLEMENTER_PROVIDER=openai
IMPLEMENTER_MODEL=gpt-5.4
TESTER_PROVIDER=openai
TESTER_MODEL=gpt-5.4
VERIFIER_PROVIDER=openai
VERIFIER_MODEL=gpt-5.4

AGENT_REASONING_EFFORT=default
IMPLEMENTER_REASONING_EFFORT=high
AGENT_SERVICE_TIER=default
```

For ChatGPT-login Codex CLI calls, log in once with `codex login`, then select `codex-cli` in the web settings or use:

```env
MOCK_AGENTS=0

RESEARCHER_PROVIDER=codex-cli
RESEARCHER_MODEL=default
IMPLEMENTER_PROVIDER=codex-cli
IMPLEMENTER_MODEL=default
TESTER_PROVIDER=codex-cli
TESTER_MODEL=default
VERIFIER_PROVIDER=codex-cli
VERIFIER_MODEL=default

AGENT_REASONING_EFFORT=default
IMPLEMENTER_REASONING_EFFORT=high
AGENT_SERVICE_TIER=default
```

Providers, model names, reasoning effort, and service tier are environment-driven so you can swap researcher, implementer, tester, and verifier independently.
Use `openai`, `codex-cli`, or `mock` as provider values. `codex-cli` runs `codex exec` inside the task worktree and can receive task images through Codex CLI image inputs. On Windows, shell execution may require `CODEX_CLI_SANDBOX=danger-full-access`; the harness still logs the outer Codex run and command execution events reported by Codex CLI JSON output.

The web UI has an **Agent Settings** panel. Values saved there are stored in SQLite and take precedence over `.env.local` for future task runs. Models are selected from a provider-specific list rather than typed as free-form strings. Reasoning effort supports `default`, `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`; speed supports `default`, `auto`, and `fast`. For OpenAI API calls, `fast` maps to the priority service tier. Set all role models to `GPT-5.5` there if you want the full pipeline to use GPT-5.5.

## Context Isolation

The default Codex-only flow intentionally prevents agents from seeing each other's raw work:

- `researcher` sees the task brief and collects facts.
- The broker stores a compact `evidence_pack`; only that pack is visible to `implementer`.
- `implementer` sees the task brief and broker evidence pack, not tester plans.
- The broker stores a diff-based `implementation_brief`; `tester` does not see implementer output or intent.
- `tester` sees task brief plus broker implementation brief and validates independently.
- `verifier` sees broker artifacts and command evidence, not private raw agent logs.

## Unity Worktree Flow

For Unity projects, the harness avoids mutating the editor checkout for implementation and validation:

- Read-only roles use the target checkout when they do not need a separate ref.
- `implementer` changes are committed to `harness/<task>/implementer/rN`.
- `tester` gets a worktree based on that implementation commit and runs the configured verification command there.
- `verifier` judges from broker artifacts and command evidence, reusing the clean implementation worktree instead of creating another role worktree.
- Only a `pass` verifier decision merges the implementation branch into `HARNESS_INTEGRATION_BRANCH`, which defaults to `imjae`.
- Open Unity against the `imjae` integration branch/worktree for manual visual confirmation, then merge to `main` outside the harness when satisfied.

## Scope References

The task `Scope` field supports lightweight `@` references. Type `@` in the Scope box to search files and folders under `Target project path`, then press Enter/Tab or click a suggestion.

```text
@Assets/Scripts/UI/Trade/TradeInventoryPopup.cs
@Assets/Scripts/UI/Trade
@"Assets/Folder With Spaces"
```

References are resolved inside the task worktree during execution, so they cannot read files outside the task workspace.
File references attach clipped text content to the agent prompt. Folder references attach a shallow directory listing only. Use `Scope` for file/folder hints and hard constraints; use `Goal` for the actual request.

Suggestion priority:

- If the query includes an extension, exact file-name matches appear first. Contains matches appear below a divider.
- If the query has no extension, exact folder names and exact file stems appear first. Contains matches for files and folders appear below a divider.

## Execution Management

Each agent run is managed as a short sub-agent slice:

- `AGENT_CONTEXT_BUDGET_CHARS` limits the prompt passed to one agent.
- `AGENT_OUTPUT_BUDGET_CHARS` limits handoff text passed to the next agent.
- `AGENT_TIME_BUDGET_MS` stops an agent slice that runs too long.
- `IMPLEMENTER_TIME_BUDGET_MS` overrides the implementer slice budget; it defaults to 900000ms, or 15 minutes.
- Agent logs show input size, output size, context budget, time budget, trimming, and timeout status.

This keeps long tasks from loading one agent with all context, all roles, and all verification at once.

## Verification Mode

New tasks default to `Fast` verification:

- `Fast`: runs `researcher -> implementer -> verifier`. The tester agent is skipped to reduce round time.
- `Balanced`: runs `researcher -> implementer -> tester -> verifier` for higher-risk tasks that need an independent tester agent.

## Planning Mode

New tasks default to `Direct` planning:

- `Direct`: runs implementation after the researcher evidence pack is ready.
- `Plan`: runs `researcher -> planner`, pauses the task as `waiting_for_user`, shows the planner questions in the web UI, then resumes after the user submits answers. User waiting time is not counted against agent time budgets.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

New tasks do not run a shell verification command by default. Leave the verification command blank for broker/artifact-based validation, or enter a project-specific command when a task needs an explicit gate.

For isolated Unity worktrees, generated `.sln` / `.csproj` files may be copied into the tester worktree and temporarily patched for added or removed `.cs` files only when you explicitly enter a `dotnet build ... .sln` command. These generated files are verification inputs only and are not committed. Prefab, scene, and `.asset` changes are reported as residual Unity import risk.

## Notion Sync

Task reports can be synced to Notion as child pages under a configured parent page.

```env
NOTION_TOKEN=secret_...
NOTION_PARENT_PAGE_ID=...
```

The Notion token is read only on the server and is never exposed to the browser. In the web UI, open **Settings** and set the parent page ID under **Notion Sync**. Use **Sync Notion** on a selected task to create or update its Notion page.

Synced reports are generated from task metadata, broker artifacts, verifier decisions, and agent run summaries. Raw shell output and raw agent logs are not used as the primary shared report body.

## Git-Tracked Project Memory

The live SQLite database is intentionally ignored. For task history that should travel with the repository, commit sanitized Markdown reports under `docs/task-reports/`.

Commit these shared documents:

- `AGENTS.md` for agent operating rules.
- `CONVENTIONS.md` for harness engineering conventions.
- `docs/task-reports/*.md` for task reports that can also be mirrored to Notion.

Do not commit `.data/`, `.harness/`, `.env.local`, raw shell logs, or raw unredacted agent logs.
