import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { nowIso } from "@/lib/time";
import type {
  AgentRole,
  AgentRun,
  AgentProvider,
  AgentSetting,
  NotionSettings,
  NotionSync,
  BrokerArtifact,
  ConventionNote,
  Project,
  ShellLog,
  Task,
  TaskDetail,
  TaskStatus,
  Verification,
  VerificationDecision
} from "@/lib/types";

let db: DatabaseType | null = null;
let dbPathCache: string | null = null;

function databasePath(): string {
  const configuredPath = process.env.HARNESS_DB_PATH || ".data/harness.sqlite";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(/* turbopackIgnore: true */ process.cwd(), configuredPath);
}

export function resetDbForTests(): void {
  db?.close();
  db = null;
  dbPathCache = null;
}

export function getDb(): DatabaseType {
  const targetPath = databasePath();
  if (db && dbPathCache === targetPath) {
    return db;
  }

  db?.close();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  db = new Database(targetPath);
  dbPathCache = targetPath;
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(database: DatabaseType): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      verification_command TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      scope TEXT NOT NULL,
      target_project_path TEXT NOT NULL,
      worktree_path TEXT,
      agent_plan TEXT NOT NULL,
      approval_grant INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_round INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT NOT NULL,
      round INTEGER NOT NULL,
      status TEXT NOT NULL,
      context_budget_chars INTEGER NOT NULL DEFAULT 0,
      time_budget_ms INTEGER NOT NULL DEFAULT 0,
      input_chars INTEGER NOT NULL DEFAULT 0,
      output_chars INTEGER NOT NULL DEFAULT 0,
      was_trimmed INTEGER NOT NULL DEFAULT 0,
      timed_out INTEGER NOT NULL DEFAULT 0,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_settings (
      role TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notion_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      parent_page_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notion_syncs (
      task_id TEXT PRIMARY KEY,
      notion_page_id TEXT NOT NULL,
      notion_url TEXT,
      synced_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      decision TEXT NOT NULL,
      summary TEXT NOT NULL,
      command TEXT,
      exit_code INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shell_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT NOT NULL,
      exit_code INTEGER,
      stdout TEXT NOT NULL,
      stderr TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS broker_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      source_role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS convention_notes (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      category TEXT NOT NULL,
      rule TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      examples TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const agentRunColumns = database.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>;
  if (!agentRunColumns.some((column) => column.name === "provider")) {
    database.exec("ALTER TABLE agent_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai';");
  }
  const agentRunColumnNames = new Set(
    (database.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const agentRunMigrations: Array<[string, string]> = [
    ["context_budget_chars", "ALTER TABLE agent_runs ADD COLUMN context_budget_chars INTEGER NOT NULL DEFAULT 0;"],
    ["time_budget_ms", "ALTER TABLE agent_runs ADD COLUMN time_budget_ms INTEGER NOT NULL DEFAULT 0;"],
    ["input_chars", "ALTER TABLE agent_runs ADD COLUMN input_chars INTEGER NOT NULL DEFAULT 0;"],
    ["output_chars", "ALTER TABLE agent_runs ADD COLUMN output_chars INTEGER NOT NULL DEFAULT 0;"],
    ["was_trimmed", "ALTER TABLE agent_runs ADD COLUMN was_trimmed INTEGER NOT NULL DEFAULT 0;"],
    ["timed_out", "ALTER TABLE agent_runs ADD COLUMN timed_out INTEGER NOT NULL DEFAULT 0;"]
  ];
  for (const [column, sql] of agentRunMigrations) {
    if (!agentRunColumnNames.has(column)) {
      database.exec(sql);
    }
  }
}

function boolFromDb(value: unknown): boolean {
  return value === 1 || value === true;
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    goal: String(row.goal),
    scope: String(row.scope),
    targetProjectPath: String(row.target_project_path),
    worktreePath: row.worktree_path ? String(row.worktree_path) : null,
    agentPlan: String(row.agent_plan),
    approvalGrant: boolFromDb(row.approval_grant),
    status: String(row.status) as TaskStatus,
    currentRound: Number(row.current_round),
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapAgentRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    role: String(row.role) as AgentRole,
    provider: String(row.provider || "openai") as AgentProvider,
    model: String(row.model),
    round: Number(row.round),
    status: String(row.status) as AgentRun["status"],
    contextBudgetChars: Number(row.context_budget_chars || 0),
    timeBudgetMs: Number(row.time_budget_ms || 0),
    inputChars: Number(row.input_chars || 0),
    outputChars: Number(row.output_chars || 0),
    wasTrimmed: boolFromDb(row.was_trimmed),
    timedOut: boolFromDb(row.timed_out),
    input: String(row.input),
    output: row.output ? String(row.output) : null,
    error: row.error ? String(row.error) : null,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null
  };
}

function mapAgentSetting(row: Record<string, unknown>): AgentSetting {
  return {
    role: String(row.role) as AgentSetting["role"],
    provider: String(row.provider) as AgentProvider,
    model: String(row.model),
    updatedAt: String(row.updated_at)
  };
}

function mapShellLog(row: Record<string, unknown>): ShellLog {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    agentRole: String(row.agent_role) as AgentRole,
    command: String(row.command),
    cwd: String(row.cwd),
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    stdout: String(row.stdout),
    stderr: String(row.stderr),
    durationMs: Number(row.duration_ms),
    createdAt: String(row.created_at)
  };
}

function mapVerification(row: Record<string, unknown>): Verification {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    round: Number(row.round),
    decision: String(row.decision) as VerificationDecision,
    summary: String(row.summary),
    command: row.command ? String(row.command) : null,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    createdAt: String(row.created_at)
  };
}

function mapBrokerArtifact(row: Record<string, unknown>): BrokerArtifact {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    round: Number(row.round),
    sourceRole: String(row.source_role) as BrokerArtifact["sourceRole"],
    kind: String(row.kind) as BrokerArtifact["kind"],
    content: String(row.content),
    createdAt: String(row.created_at)
  };
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    verificationCommand: row.verification_command ? String(row.verification_command) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapNotionSync(row: Record<string, unknown>): NotionSync {
  return {
    taskId: String(row.task_id),
    notionPageId: String(row.notion_page_id),
    notionUrl: row.notion_url ? String(row.notion_url) : null,
    syncedAt: String(row.synced_at)
  };
}

function mapConvention(row: Record<string, unknown>): ConventionNote {
  return {
    id: String(row.id),
    projectPath: String(row.project_path),
    category: String(row.category),
    rule: String(row.rule),
    reason: String(row.reason),
    source: String(row.source),
    confidence: String(row.confidence) as ConventionNote["confidence"],
    examples: String(row.examples),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function upsertProject(input: {
  path: string;
  name?: string;
  verificationCommand?: string | null;
}): Project {
  const database = getDb();
  const existing = database
    .prepare("SELECT * FROM projects WHERE path = ?")
    .get(input.path) as Record<string, unknown> | undefined;
  const timestamp = nowIso();
  if (existing) {
    database
      .prepare(
        "UPDATE projects SET name = ?, verification_command = COALESCE(?, verification_command), updated_at = ? WHERE path = ?"
      )
      .run(input.name || String(existing.name), input.verificationCommand ?? null, timestamp, input.path);
    return mapProject(
      database.prepare("SELECT * FROM projects WHERE path = ?").get(input.path) as Record<string, unknown>
    );
  }

  const project: Project = {
    id: randomUUID(),
    name: input.name || path.basename(input.path) || input.path,
    path: input.path,
    verificationCommand: input.verificationCommand || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  database
    .prepare(
      "INSERT INTO projects (id, name, path, verification_command, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(project.id, project.name, project.path, project.verificationCommand, project.createdAt, project.updatedAt);
  return project;
}

export function listProjects(): Project[] {
  return (getDb().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(
    mapProject
  );
}

export function getProjectByPath(projectPath: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE path = ?").get(projectPath) as
    | Record<string, unknown>
    | undefined;
  return row ? mapProject(row) : null;
}

export function createTask(input: {
  title: string;
  goal: string;
  scope: string;
  targetProjectPath: string;
  agentPlan: string;
  approvalGrant: boolean;
}): Task {
  const timestamp = nowIso();
  const task: Task = {
    id: randomUUID(),
    title: input.title,
    goal: input.goal,
    scope: input.scope,
    targetProjectPath: input.targetProjectPath,
    worktreePath: null,
    agentPlan: input.agentPlan,
    approvalGrant: input.approvalGrant,
    status: "queued",
    currentRound: 0,
    failureReason: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  getDb()
    .prepare(
      `INSERT INTO tasks
      (id, title, goal, scope, target_project_path, worktree_path, agent_plan, approval_grant, status, current_round, failure_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.id,
      task.title,
      task.goal,
      task.scope,
      task.targetProjectPath,
      task.worktreePath,
      task.agentPlan,
      task.approvalGrant ? 1 : 0,
      task.status,
      task.currentRound,
      task.failureReason,
      task.createdAt,
      task.updatedAt
    );
  return task;
}

export function listTasks(): Task[] {
  return (getDb().prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(
    mapTask
  );
}

export function getTask(id: string): Task | null {
  const row = getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapTask(row) : null;
}

export function getTaskDetail(id: string): TaskDetail | null {
  const task = getTask(id);
  if (!task) {
    return null;
  }
  const database = getDb();
  return {
    ...task,
    agentRuns: (
      database.prepare("SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at ASC").all(id) as Record<
        string,
        unknown
      >[]
    ).map(mapAgentRun),
    shellLogs: (
      database.prepare("SELECT * FROM shell_logs WHERE task_id = ? ORDER BY created_at ASC").all(id) as Record<
        string,
        unknown
      >[]
    ).map(mapShellLog),
    verifications: (
      database.prepare("SELECT * FROM verifications WHERE task_id = ? ORDER BY created_at ASC").all(id) as Record<
        string,
        unknown
      >[]
    ).map(mapVerification),
    brokerArtifacts: (
      database.prepare("SELECT * FROM broker_artifacts WHERE task_id = ? ORDER BY created_at ASC").all(id) as Record<
        string,
        unknown
      >[]
    ).map(mapBrokerArtifact),
    notionSync: getNotionSync(id)
  };
}

export function updateTask(id: string, patch: Partial<Pick<Task, "status" | "worktreePath" | "currentRound" | "failureReason">>): void {
  const current = getTask(id);
  if (!current) {
    return;
  }
  const merged = { ...current, ...patch, updatedAt: nowIso() };
  getDb()
    .prepare(
      "UPDATE tasks SET status = ?, worktree_path = ?, current_round = ?, failure_reason = ?, updated_at = ? WHERE id = ?"
    )
    .run(
      merged.status,
      merged.worktreePath,
      merged.currentRound,
      merged.failureReason,
      merged.updatedAt,
      id
    );
}

export function createTaskRun(taskId: string): string {
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO task_runs (id, task_id, status, started_at) VALUES (?, ?, ?, ?)")
    .run(id, taskId, "running", nowIso());
  return id;
}

export function finishTaskRun(id: string, status: string): void {
  getDb()
    .prepare("UPDATE task_runs SET status = ?, finished_at = ? WHERE id = ?")
    .run(status, nowIso(), id);
}

export function createAgentRun(input: {
  taskId: string;
  role: AgentRole;
  provider: AgentProvider;
  model: string;
  round: number;
  prompt: string;
  contextBudgetChars: number;
  timeBudgetMs: number;
  inputChars: number;
  wasTrimmed: boolean;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO agent_runs
      (id, task_id, role, provider, model, round, status, context_budget_chars, time_budget_ms, input_chars, was_trimmed, input, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.taskId,
      input.role,
      input.provider,
      input.model,
      input.round,
      "running",
      input.contextBudgetChars,
      input.timeBudgetMs,
      input.inputChars,
      input.wasTrimmed ? 1 : 0,
      input.prompt,
      nowIso()
    );
  return id;
}

export function getAgentSetting(role: AgentSetting["role"]): AgentSetting | null {
  const row = getDb().prepare("SELECT * FROM agent_settings WHERE role = ?").get(role) as
    | Record<string, unknown>
    | undefined;
  return row ? mapAgentSetting(row) : null;
}

export function listAgentSettings(): AgentSetting[] {
  return (getDb().prepare("SELECT * FROM agent_settings ORDER BY role ASC").all() as Record<string, unknown>[]).map(
    mapAgentSetting
  );
}

export function upsertAgentSetting(input: Omit<AgentSetting, "updatedAt">): AgentSetting {
  const updatedAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO agent_settings (role, provider, model, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(role) DO UPDATE SET provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at`
    )
    .run(input.role, input.provider, input.model, updatedAt);
  return {
    ...input,
    updatedAt
  };
}

export function getNotionSettings(): NotionSettings {
  const row = getDb().prepare("SELECT * FROM notion_settings WHERE id = 1").get() as
    | Record<string, unknown>
    | undefined;
  const parentPageId = row?.parent_page_id ? String(row.parent_page_id) : process.env.NOTION_PARENT_PAGE_ID || "";
  return {
    parentPageId,
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
    tokenConfigured: Boolean(process.env.NOTION_TOKEN)
  };
}

export function updateNotionSettings(input: { parentPageId: string }): NotionSettings {
  const updatedAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO notion_settings (id, parent_page_id, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET parent_page_id = excluded.parent_page_id, updated_at = excluded.updated_at`
    )
    .run(input.parentPageId, updatedAt);
  return {
    parentPageId: input.parentPageId,
    updatedAt,
    tokenConfigured: Boolean(process.env.NOTION_TOKEN)
  };
}

export function getNotionSync(taskId: string): NotionSync | null {
  const row = getDb().prepare("SELECT * FROM notion_syncs WHERE task_id = ?").get(taskId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapNotionSync(row) : null;
}

export function upsertNotionSync(input: Omit<NotionSync, "syncedAt">): NotionSync {
  const syncedAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO notion_syncs (task_id, notion_page_id, notion_url, synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        notion_page_id = excluded.notion_page_id,
        notion_url = excluded.notion_url,
        synced_at = excluded.synced_at`
    )
    .run(input.taskId, input.notionPageId, input.notionUrl, syncedAt);
  return {
    ...input,
    syncedAt
  };
}

export function finishAgentRun(id: string, output: string, error?: string, timedOut = false): void {
  getDb()
    .prepare(
      "UPDATE agent_runs SET status = ?, output = ?, output_chars = ?, error = ?, timed_out = ?, finished_at = ? WHERE id = ?"
    )
    .run(error ? "failed" : "done", output, output.length, error || null, timedOut ? 1 : 0, nowIso(), id);
}

export function insertShellLog(input: Omit<ShellLog, "id" | "createdAt">): ShellLog {
  const log: ShellLog = {
    ...input,
    id: randomUUID(),
    createdAt: nowIso()
  };
  getDb()
    .prepare(
      `INSERT INTO shell_logs
      (id, task_id, agent_role, command, cwd, exit_code, stdout, stderr, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      log.id,
      log.taskId,
      log.agentRole,
      log.command,
      log.cwd,
      log.exitCode,
      log.stdout,
      log.stderr,
      log.durationMs,
      log.createdAt
    );
  return log;
}

export function insertVerification(input: {
  taskId: string;
  round: number;
  decision: VerificationDecision;
  summary: string;
  command: string | null;
  exitCode: number | null;
}): Verification {
  const verification: Verification = {
    id: randomUUID(),
    taskId: input.taskId,
    round: input.round,
    decision: input.decision,
    summary: input.summary,
    command: input.command,
    exitCode: input.exitCode,
    createdAt: nowIso()
  };
  getDb()
    .prepare(
      "INSERT INTO verifications (id, task_id, round, decision, summary, command, exit_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      verification.id,
      verification.taskId,
      verification.round,
      verification.decision,
      verification.summary,
      verification.command,
      verification.exitCode,
      verification.createdAt
    );
  return verification;
}

export function insertBrokerArtifact(input: {
  taskId: string;
  round: number;
  sourceRole: BrokerArtifact["sourceRole"];
  kind: BrokerArtifact["kind"];
  content: string;
}): BrokerArtifact {
  const artifact: BrokerArtifact = {
    id: randomUUID(),
    taskId: input.taskId,
    round: input.round,
    sourceRole: input.sourceRole,
    kind: input.kind,
    content: input.content,
    createdAt: nowIso()
  };
  getDb()
    .prepare(
      "INSERT INTO broker_artifacts (id, task_id, round, source_role, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      artifact.id,
      artifact.taskId,
      artifact.round,
      artifact.sourceRole,
      artifact.kind,
      artifact.content,
      artifact.createdAt
    );
  return artifact;
}

export function createConventionNote(input: Omit<ConventionNote, "id" | "createdAt" | "updatedAt">): ConventionNote {
  const timestamp = nowIso();
  const note: ConventionNote = {
    ...input,
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  getDb()
    .prepare(
      `INSERT INTO convention_notes
      (id, project_path, category, rule, reason, source, confidence, examples, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      note.id,
      note.projectPath,
      note.category,
      note.rule,
      note.reason,
      note.source,
      note.confidence,
      note.examples,
      note.createdAt,
      note.updatedAt
    );
  return note;
}

export function listConventionNotes(projectPath?: string): ConventionNote[] {
  const database = getDb();
  const rows = projectPath
    ? (database
        .prepare("SELECT * FROM convention_notes WHERE project_path = ? ORDER BY category, created_at DESC")
        .all(projectPath) as Record<string, unknown>[])
    : (database.prepare("SELECT * FROM convention_notes ORDER BY project_path, category, created_at DESC").all() as Record<
        string,
        unknown
      >[]);
  return rows.map(mapConvention);
}
