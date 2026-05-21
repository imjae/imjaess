export type TaskStatus =
  | "queued"
  | "running"
  | "reviewing"
  | "verifying"
  | "needs_fix"
  | "done"
  | "blocked";

export type AgentRole = "researcher" | "implementer" | "tester" | "verifier";

export type AgentProvider = "openai" | "codex-cli" | "mock";

export type VerificationDecision = "pass" | "needs_fix" | "blocked";

export interface AgentSetting {
  role: AgentRole;
  provider: AgentProvider;
  model: string;
  updatedAt: string;
}

export interface NotionSettings {
  parentPageId: string;
  updatedAt: string | null;
  tokenConfigured: boolean;
}

export interface NotionSync {
  taskId: string;
  notionPageId: string;
  notionUrl: string | null;
  syncedAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  verificationCommand: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskGroup {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  parentTaskId: string | null;
  taskGroup: string;
  title: string;
  goal: string;
  scope: string;
  targetProjectPath: string;
  worktreePath: string | null;
  agentPlan: string;
  approvalGrant: boolean;
  status: TaskStatus;
  currentRound: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  originalName: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  role: AgentRole;
  provider: AgentProvider;
  model: string;
  round: number;
  status: "running" | "done" | "failed";
  contextBudgetChars: number;
  timeBudgetMs: number;
  inputChars: number;
  outputChars: number;
  wasTrimmed: boolean;
  timedOut: boolean;
  workspacePath: string | null;
  branchName: string | null;
  input: string;
  output: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BrokerArtifact {
  id: string;
  taskId: string;
  round: number;
  sourceRole: AgentRole | "broker";
  kind: "evidence_pack" | "implementation_brief" | "test_brief" | "test_result" | "final_brief";
  content: string;
  createdAt: string;
}

export interface ShellLog {
  id: string;
  taskId: string;
  agentRole: AgentRole;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  createdAt: string;
}

export interface Verification {
  id: string;
  taskId: string;
  round: number;
  decision: VerificationDecision;
  summary: string;
  command: string | null;
  exitCode: number | null;
  createdAt: string;
}

export interface ConventionNote {
  id: string;
  projectPath: string;
  category: string;
  rule: string;
  reason: string;
  source: string;
  confidence: "low" | "medium" | "high";
  examples: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends Task {
  childTasks: Task[];
  attachments: TaskAttachment[];
  agentRuns: AgentRun[];
  shellLogs: ShellLog[];
  verifications: Verification[];
  brokerArtifacts: BrokerArtifact[];
  notionSync: NotionSync | null;
}

export interface CreateTaskInput {
  title: string;
  taskGroup?: string;
  goal: string;
  scope?: string;
  targetProjectPath: string;
  agentPlan?: string;
  approvalGrant?: boolean;
  verificationCommand?: string;
}
