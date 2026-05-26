# Project Handoff Checklist

이 프로젝트를 새로 받은 뒤에는 아래 항목을 로컬 환경에 맞게 직접 채워야 한다. 비밀값, 로컬 경로, 런타임 DB는 git에 커밋하지 않는다.

## Required Local Files

- `.env.local`
  - `.env.example`을 복사해서 만든다.
  - `OPENAI_API_KEY`: OpenAI API 키.
  - `MOCK_AGENTS`: 실제 agent를 실행하려면 `0`, 더미 실행은 `1`.
  - `RESEARCHER_PROVIDER`, `IMPLEMENTER_PROVIDER`, `TESTER_PROVIDER`, `VERIFIER_PROVIDER`: `openai`, `codex-cli`, `mock` 중 선택.
  - `RESEARCHER_MODEL`, `IMPLEMENTER_MODEL`, `TESTER_MODEL`, `VERIFIER_MODEL`: UI 설정과 함께 사용할 기본 모델.
  - `CODEX_CLI_PATH`: `codex`가 PATH에 없을 때 `codex.exe` 전체 경로.
  - `CODEX_CLI_SANDBOX`: Codex CLI provider의 sandbox 모드. Windows shell 실행은 `danger-full-access`가 필요할 수 있다.
  - `HARNESS_DB_PATH`: 로컬 SQLite 저장 위치. 기본값은 `.data/harness.sqlite`.
  - `HARNESS_ATTACHMENT_DIR`: 이미지 첨부 저장 위치. 비워두면 `.data/attachments`, 직접 지정할 경우 절대경로를 사용한다.
  - `HARNESS_INTEGRATION_BRANCH`: 검증 통과 브랜치를 병합할 통합 브랜치. 기본값은 `imjae`.
  - `MAX_AGENT_ROUNDS`: 태스크당 자동 수정 반복 한도.
  - `AGENT_CONTEXT_BUDGET_CHARS`, `AGENT_OUTPUT_BUDGET_CHARS`, `AGENT_TIME_BUDGET_MS`: role별 컨텍스트, 출력, 시간 제한 기본값.

- Notion integration 설정
  - `NOTION_TOKEN`: Notion 내부 통합 토큰.
  - `NOTION_PARENT_PAGE_ID`: 태스크 리포트를 생성할 부모 페이지 ID.
  - Notion에서 해당 부모 페이지를 integration에 공유해야 한다.

## Local Data Not Committed

- `.data/harness.sqlite`
  - 태스크, agent 실행 기록, shell 로그, 검증 결과, 컨벤션 메모가 저장된다.
  - 실시간 작업 내역이므로 기본적으로 git에 올리지 않는다.
  - 동기화가 필요하면 Notion sync 또는 별도 Markdown export를 사용한다.

- `.harness/`
  - agent role/round별 git worktree와 `imjae` 통합 worktree가 저장된다.
  - 프로젝트마다 절대 경로와 로컬 상태가 달라지므로 git에 올리지 않는다.

## Project-Specific Inputs

- Scope references
  - Type `@` in `Scope` to search files and folders under `Target project path`.
  - Press Enter/Tab or click a suggestion to insert it.
  - `Scope` can list `@filePath` and `@folderPath` references.
  - Example: `@Assets/Scripts/UI/Trade/TradeInventoryPopup.cs @Assets/Scripts/UI/Trade`
  - Use quotes for paths with spaces: `@"Assets/Folder With Spaces"`.
  - File references attach clipped file content to agent context.
  - Folder references attach a shallow directory listing only.
  - References are limited to the task worktree.

- 대상 프로젝트 경로
  - UI에서 `Target project path`로 입력한다.
  - 예: Unity 프로젝트 루트 또는 작업할 git repository 경로.

- 검증 명령
  - 태스크 생성 시 프로젝트에 맞게 입력한다.
  - 기본값은 비워 둔다. 명시적으로 입력한 경우에만 shell 검증 명령이 실행된다.
  - 검증 모드는 새 Task 기본값이 `fast`이며, 독립 Tester Agent가 필요한 경우 `balanced`를 선택한다.

- Planning mode
  - Default is `direct`.
  - Choose `plan` when the Planner should ask questions before implementation. The task pauses as `waiting_for_user` and resumes after answers are submitted in the web UI.

- Unity convention notes
  - UI의 Unity Rules 영역에서 프로젝트별 규칙을 추가한다.
  - 필요한 항목: `category`, `rule`, `reason`, `source`, `confidence`, `examples`.
  - 필요 시 `AGENTS.md`와 `CONVENTIONS.md` 초안 export를 사용한다.

## Recommended Sync Documents

- `AGENTS.md`
  - Git에 같이 올린다.
  - agent가 따라야 할 프로젝트별 작업 규칙을 기록한다.
  - Unity 프로젝트라면 폴더 구조, 빌드 명령, 금지 작업, 코드 스타일을 포함한다.

- `CONVENTIONS.md`
  - Git에 같이 올린다.
  - 사람이 읽는 코드/Unity 컨벤션 문서다.
  - Inspector 세팅, Addressables, prefab/meta 처리, 네이밍 규칙 같은 로컬 지식을 정리한다.

- `docs/task-reports/*.md`
  - Git에 같이 올릴 수 있는 태스크 기록이다.
  - Notion task report와 같은 내용을 Markdown으로 보관한다.
  - raw DB, raw shell log, API key, private path는 넣지 않는다.

- Notion task report
  - 태스크 목표, role별 실행 요약, broker artifact, verifier 판정을 공유한다.
  - raw SQLite DB 대신 공유용 기록으로 사용한다.
