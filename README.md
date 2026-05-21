# Local Multi-Agent Harness

Localhost-only MVP for running context-isolated Codex agents through a `Researcher -> Implementer -> Tester -> Verifier` loop.

## Context Isolation

The default Codex-only flow intentionally prevents agents from seeing each other's raw work:

- `researcher` sees the task brief and collects facts.
- The broker stores a compact `evidence_pack`; only that pack is visible to `implementer`.
- `implementer` sees the task brief and broker evidence pack, not tester plans.
- The broker stores a diff-based `implementation_brief`; `tester` does not see implementer output or intent.
- `tester` sees task brief plus broker implementation brief and validates independently.
- `verifier` sees broker artifacts and command evidence, not private raw agent logs.
