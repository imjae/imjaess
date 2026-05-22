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
  TaskAttachment,
  TaskDetail,
  TaskGroup,
  TaskTag,
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
      parent_task_id TEXT,
      task_group TEXT NOT NULL DEFAULT '',
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_groups (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_tag_links (
      task_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, tag_name),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_name) REFERENCES task_tags(name) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
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
      workspace_path TEXT,
      branch_name TEXT,
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
      reasoning_effort TEXT NOT NULL DEFAULT 'default',
      service_tier TEXT NOT NULL DEFAULT 'default',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notion_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      parent_page_id TEXT NOT NULL,
      database_id TEXT,
      data_source_id TEXT,
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
    ["timed_out", "ALTER TABLE agent_runs ADD COLUMN timed_out INTEGER NOT NULL DEFAULT 0;"],
    ["workspace_path", "ALTER TABLE agent_runs ADD COLUMN workspace_path TEXT;"],
    ["branch_name", "ALTER TABLE agent_runs ADD COLUMN branch_name TEXT;"],
    ["reasoning_effort", "ALTER TABLE agent_runs ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'default';"],
    ["service_tier", "ALTER TABLE agent_runs ADD COLUMN service_tier TEXT NOT NULL DEFAULT 'default';"]
  ];
  for (const [column, sql] of agentRunMigrations) {
    if (!agentRunColumnNames.has(column)) {
      database.exec(sql);
    }
  }
  const agentSettingColumnNames = new Set(
    (database.prepare("PRAGMA table_info(agent_settings)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const agentSettingMigrations: Array<[string, string]> = [
    ["reasoning_effort", "ALTER TABLE agent_settings ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'default';"],
    ["service_tier", "ALTER TABLE agent_settings ADD COLUMN service_tier TEXT NOT NULL DEFAULT 'default';"]
  ];
  for (const [column, sql] of agentSettingMigrations) {
    if (!agentSettingColumnNames.has(column)) {
      database.exec(sql);
    }
  }
  const notionSettingColumnNames = new Set(
    (database.prepare("PRAGMA table_info(notion_settings)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const notionSettingMigrations: Array<[string, string]> = [
    ["database_id", "ALTER TABLE notion_settings ADD COLUMN database_id TEXT;"],
    ["data_source_id", "ALTER TABLE notion_settings ADD COLUMN data_source_id TEXT;"]
  ];
  for (const [column, sql] of notionSettingMigrations) {
    if (!notionSettingColumnNames.has(column)) {
      database.exec(sql);
    }
  }
  const taskColumnNames = new Set(
    (database.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!taskColumnNames.has("parent_task_id")) {
    database.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;");
  }
  if (!taskColumnNames.has("task_group")) {
    database.exec("ALTER TABLE tasks ADD COLUMN task_group TEXT NOT NULL DEFAULT '';");
  }
  database.exec(`
    INSERT OR IGNORE INTO task_groups (name, created_at, updated_at)
    SELECT DISTINCT TRIM(task_group), created_at, updated_at
    FROM tasks
    WHERE TRIM(task_group) <> '';

    INSERT OR IGNORE INTO task_tags (name, created_at, updated_at)
    SELECT DISTINCT TRIM(task_group), created_at, updated_at
    FROM tasks
    WHERE TRIM(task_group) <> '';

    INSERT OR IGNORE INTO task_tag_links (task_id, tag_name, created_at)
    SELECT id, TRIM(task_group), created_at
    FROM tasks
    WHERE TRIM(task_group) <> '';
  `);
}

function boolFromDb(value: unknown): boolean {
  return value === 1 || value === true;
}

function normalizeTaskTags(tags: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const trimmed = (tag || "").trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function listTaskTagNamesForTask(taskId: string): string[] {
  return (
    getDb()
      .prepare("SELECT tag_name FROM task_tag_links WHERE task_id = ? ORDER BY tag_name COLLATE NOCASE ASC")
      .all(taskId) as Array<{ tag_name: string }>
  ).map((row) => row.tag_name);
}

function mapTask(row: Record<string, unknown>): Task {
  const tags = listTaskTagNamesForTask(String(row.id));
  const legacyGroup = row.task_group ? String(row.task_group) : "";
  return {
    id: String(row.id),
    parentTaskId: row.parent_task_id ? String(row.parent_task_id) : null,
    taskGroup: legacyGroup || tags[0] || "",
    tags,
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
    reasoningEffort: String(row.reasoning_effort || "default") as AgentRun["reasoningEffort"],
    serviceTier: String(row.service_tier || "default") as AgentRun["serviceTier"],
    round: Number(row.round),
    status: String(row.status) as AgentRun["status"],
    contextBudgetChars: Number(row.context_budget_chars || 0),
    timeBudgetMs: Number(row.time_budget_ms || 0),
    inputChars: Number(row.input_chars || 0),
    outputChars: Number(row.output_chars || 0),
    wasTrimmed: boolFromDb(row.was_trimmed),
    timedOut: boolFromDb(row.timed_out),
    workspacePath: row.workspace_path ? String(row.workspace_path) : null,
    branchName: row.branch_name ? String(row.branch_name) : null,
    input: String(row.input),
    output: row.output ? String(row.output) : null,
    error: row.error ? String(row.error) : null,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null
  };
}

function mapTaskAttachment(row: Record<string, unknown>): TaskAttachment {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    originalName: String(row.original_name),
    storedPath: String(row.stored_path),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    createdAt: String(row.created_at)
  };
}

function mapAgentSetting(row: Record<string, unknown>): AgentSetting {
  return {
    role: String(row.role) as AgentSetting["role"],
    provider: String(row.provider) as AgentProvider,
    model: String(row.model),
    reasoningEffort: String(row.reasoning_effort || "default") as AgentSetting["reasoningEffort"],
    serviceTier: String(row.service_tier || "default") as AgentSetting["serviceTier"],
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

function mapTaskGroup(row: Record<string, unknown>): TaskGroup {
  return {
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapTaskTag(row: Record<string, unknown>): TaskTag {
  return {
    name: String(row.name),
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

export function upsertTaskGroup(name: string): TaskGroup | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }
  const timestamp = nowIso();
  const database = getDb();
  database
    .prepare(
      `INSERT INTO task_groups (name, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`
    )
    .run(trimmedName, timestamp, timestamp);
  return mapTaskGroup(database.prepare("SELECT * FROM task_groups WHERE name = ?").get(trimmedName) as Record<string, unknown>);
}

export function listTaskGroups(): TaskGroup[] {
  return (getDb().prepare("SELECT * FROM task_groups ORDER BY name COLLATE NOCASE ASC").all() as Record<
    string,
    unknown
  >[]).map(mapTaskGroup);
}

export function upsertTaskTag(name: string): TaskTag | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }
  const timestamp = nowIso();
  const database = getDb();
  database
    .prepare(
      `INSERT INTO task_tags (name, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`
    )
    .run(trimmedName, timestamp, timestamp);
  upsertTaskGroup(trimmedName);
  return mapTaskTag(database.prepare("SELECT * FROM task_tags WHERE name = ?").get(trimmedName) as Record<string, unknown>);
}

export function listTaskTags(): TaskTag[] {
  return (getDb().prepare("SELECT * FROM task_tags ORDER BY name COLLATE NOCASE ASC").all() as Record<
    string,
    unknown
  >[]).map(mapTaskTag);
}

export function deleteTaskTag(name: string): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return false;
  }
  const timestamp = nowIso();
  const database = getDb();
  const remove = database.transaction(() => {
    const affectedTaskIds = (
      database.prepare("SELECT task_id FROM task_tag_links WHERE tag_name = ?").all(trimmedName) as Array<{
        task_id: string;
      }>
    ).map((row) => row.task_id);
    const tagDelete = database.prepare("DELETE FROM task_tags WHERE name = ?").run(trimmedName);
    const legacyGroupDelete = database.prepare("DELETE FROM task_groups WHERE name = ?").run(trimmedName);
    for (const taskId of affectedTaskIds) {
      const nextTag = database
        .prepare("SELECT tag_name FROM task_tag_links WHERE task_id = ? ORDER BY tag_name COLLATE NOCASE ASC LIMIT 1")
        .get(taskId) as { tag_name: string } | undefined;
      database
        .prepare("UPDATE tasks SET task_group = ?, updated_at = ? WHERE id = ?")
        .run(nextTag?.tag_name || "", timestamp, taskId);
    }
    return tagDelete.changes + legacyGroupDelete.changes;
  });
  return remove() > 0;
}

export function replaceTaskTags(taskId: string, tags: string[]): string[] | null {
  const task = getTask(taskId);
  if (!task) {
    return null;
  }
  const normalizedTags = normalizeTaskTags(tags);
  const timestamp = nowIso();
  const database = getDb();
  const update = database.transaction(() => {
    database.prepare("DELETE FROM task_tag_links WHERE task_id = ?").run(taskId);
    for (const tag of normalizedTags) {
      upsertTaskTag(tag);
      database
        .prepare("INSERT OR IGNORE INTO task_tag_links (task_id, tag_name, created_at) VALUES (?, ?, ?)")
        .run(taskId, tag, timestamp);
    }
    database
      .prepare("UPDATE tasks SET task_group = ?, updated_at = ? WHERE id = ?")
      .run(normalizedTags[0] || "", timestamp, taskId);
  });
  update();
  return normalizedTags;
}

export function createTask(input: {
  parentTaskId?: string | null;
  taskGroup?: string;
  taskTags?: string[];
  title: string;
  goal: string;
  scope: string;
  targetProjectPath: string;
  agentPlan: string;
  approvalGrant: boolean;
}): Task {
  const timestamp = nowIso();
  const tags = normalizeTaskTags([...(input.taskTags || []), input.taskGroup]);
  const task: Task = {
    id: randomUUID(),
    parentTaskId: input.parentTaskId || null,
    taskGroup: tags[0] || "",
    tags,
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
  const database = getDb();
  const insert = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO tasks
        (id, parent_task_id, task_group, title, goal, scope, target_project_path, worktree_path, agent_plan, approval_grant, status, current_round, failure_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.parentTaskId,
        task.taskGroup,
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
    for (const tag of task.tags) {
      upsertTaskTag(tag);
      database
        .prepare("INSERT OR IGNORE INTO task_tag_links (task_id, tag_name, created_at) VALUES (?, ?, ?)")
        .run(task.id, tag, timestamp);
    }
  });
  insert();
  return task;
}

export function upsertImportedTask(input: {
  id: string;
  parentTaskId?: string | null;
  taskTags?: string[];
  title: string;
  goal: string;
  scope: string;
  targetProjectPath: string;
  worktreePath?: string | null;
  agentPlan: string;
  approvalGrant: boolean;
  status: TaskStatus;
  currentRound: number;
  failureReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  verificationCommand?: string | null;
  notionPageId?: string | null;
  notionUrl?: string | null;
}): Task {
  const existing = getTask(input.id);
  const timestamp = nowIso();
  const tags = normalizeTaskTags(input.taskTags || []);
  const parentTaskId = input.parentTaskId && getTask(input.parentTaskId) ? input.parentTaskId : null;
  const task: Task = {
    id: input.id,
    parentTaskId,
    taskGroup: tags[0] || "",
    tags,
    title: input.title,
    goal: input.goal,
    scope: input.scope,
    targetProjectPath: input.targetProjectPath,
    worktreePath: input.worktreePath || null,
    agentPlan: input.agentPlan,
    approvalGrant: input.approvalGrant,
    status: input.status,
    currentRound: input.currentRound,
    failureReason: input.failureReason || null,
    createdAt: input.createdAt || existing?.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp
  };
  const database = getDb();
  const upsert = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO tasks
        (id, parent_task_id, task_group, title, goal, scope, target_project_path, worktree_path, agent_plan, approval_grant, status, current_round, failure_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          parent_task_id = excluded.parent_task_id,
          task_group = excluded.task_group,
          title = excluded.title,
          goal = excluded.goal,
          scope = excluded.scope,
          target_project_path = excluded.target_project_path,
          worktree_path = excluded.worktree_path,
          agent_plan = excluded.agent_plan,
          approval_grant = excluded.approval_grant,
          status = excluded.status,
          current_round = excluded.current_round,
          failure_reason = excluded.failure_reason,
          updated_at = excluded.updated_at`
      )
      .run(
        task.id,
        task.parentTaskId,
        task.taskGroup,
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
    database.prepare("DELETE FROM task_tag_links WHERE task_id = ?").run(task.id);
    for (const tag of tags) {
      upsertTaskTag(tag);
      database
        .prepare("INSERT OR IGNORE INTO task_tag_links (task_id, tag_name, created_at) VALUES (?, ?, ?)")
        .run(task.id, tag, timestamp);
    }
  });
  upsert();
  upsertProject({
    path: task.targetProjectPath,
    verificationCommand: input.verificationCommand || getProjectByPath(task.targetProjectPath)?.verificationCommand || null
  });
  if (input.notionPageId) {
    upsertNotionSync({
      taskId: task.id,
      notionPageId: input.notionPageId,
      notionUrl: input.notionUrl || null
    });
  }
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

export function listChildTasks(parentTaskId: string): Task[] {
  return (
    getDb().prepare("SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at DESC").all(parentTaskId) as Record<
      string,
      unknown
    >[]
  ).map(mapTask);
}

export function deleteTask(id: string): boolean {
  const result = getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getTaskDetail(id: string): TaskDetail | null {
  const task = getTask(id);
  if (!task) {
    return null;
  }
  const database = getDb();
  return {
    ...task,
    childTasks: listChildTasks(id),
    attachments: listTaskAttachments(id),
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

export function insertTaskAttachment(input: Omit<TaskAttachment, "id" | "createdAt">): TaskAttachment {
  const attachment: TaskAttachment = {
    ...input,
    id: randomUUID(),
    createdAt: nowIso()
  };
  getDb()
    .prepare(
      `INSERT INTO task_attachments
      (id, task_id, original_name, stored_path, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      attachment.id,
      attachment.taskId,
      attachment.originalName,
      attachment.storedPath,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.createdAt
    );
  return attachment;
}

export function listTaskAttachments(taskId: string): TaskAttachment[] {
  return (
    getDb().prepare("SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as Record<
      string,
      unknown
    >[]
  ).map(mapTaskAttachment);
}

export function getTaskAttachment(id: string): TaskAttachment | null {
  const row = getDb().prepare("SELECT * FROM task_attachments WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapTaskAttachment(row) : null;
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
  reasoningEffort: AgentRun["reasoningEffort"];
  serviceTier: AgentRun["serviceTier"];
  round: number;
  prompt: string;
  contextBudgetChars: number;
  timeBudgetMs: number;
  inputChars: number;
  wasTrimmed: boolean;
  workspacePath?: string | null;
  branchName?: string | null;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO agent_runs
      (id, task_id, role, provider, model, reasoning_effort, service_tier, round, status, context_budget_chars, time_budget_ms, input_chars, was_trimmed, workspace_path, branch_name, input, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.taskId,
      input.role,
      input.provider,
      input.model,
      input.reasoningEffort,
      input.serviceTier,
      input.round,
      "running",
      input.contextBudgetChars,
      input.timeBudgetMs,
      input.inputChars,
      input.wasTrimmed ? 1 : 0,
      input.workspacePath || null,
      input.branchName || null,
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
      `INSERT INTO agent_settings (role, provider, model, reasoning_effort, service_tier, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(role) DO UPDATE SET provider = excluded.provider, model = excluded.model, reasoning_effort = excluded.reasoning_effort, service_tier = excluded.service_tier, updated_at = excluded.updated_at`
    )
    .run(input.role, input.provider, input.model, input.reasoningEffort, input.serviceTier, updatedAt);
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
    databaseId: row?.database_id ? String(row.database_id) : null,
    dataSourceId: row?.data_source_id ? String(row.data_source_id) : null,
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
    tokenConfigured: Boolean(process.env.NOTION_TOKEN)
  };
}

export function updateNotionSettings(input: {
  parentPageId: string;
  databaseId?: string | null;
  dataSourceId?: string | null;
}): NotionSettings {
  const current = getNotionSettings();
  const updatedAt = nowIso();
  const parentChanged = input.parentPageId !== current.parentPageId;
  const databaseId = input.databaseId === undefined ? (parentChanged ? null : current.databaseId) : input.databaseId;
  const dataSourceId = input.dataSourceId === undefined ? (parentChanged ? null : current.dataSourceId) : input.dataSourceId;
  getDb()
    .prepare(
      `INSERT INTO notion_settings (id, parent_page_id, database_id, data_source_id, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_page_id = excluded.parent_page_id,
        database_id = excluded.database_id,
        data_source_id = excluded.data_source_id,
        updated_at = excluded.updated_at`
    )
    .run(input.parentPageId, databaseId, dataSourceId, updatedAt);
  return {
    parentPageId: input.parentPageId,
    databaseId,
    dataSourceId,
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
