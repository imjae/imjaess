import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Task, TaskStatus } from "@/lib/types";

const execFileAsync = promisify(execFile);
const BLOCKED_WORKTREE_TTL_MS = 24 * 60 * 60 * 1000;

export type WorktreeCleanupMode = "completed" | "failed" | "all" | "expired-blocked";

export interface WorktreeCleanupSummary {
  mode: WorktreeCleanupMode;
  removedWorktrees: string[];
  removedBranches: string[];
  skippedActiveTasks: string[];
  errors: string[];
}

interface RegisteredWorktree {
  path: string;
  branchName: string | null;
}

const ACTIVE_STATUSES = new Set<TaskStatus>(["queued", "running", "reviewing", "verifying"]);

function safeRefPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
  return result.stdout.trim();
}

async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    return (await git(["rev-parse", "--is-inside-work-tree"], projectPath)) === "true";
  } catch {
    return false;
  }
}

async function gitRoot(projectPath: string): Promise<string> {
  return git(["rev-parse", "--show-toplevel"], projectPath);
}

function isInside(childPath: string, parentPath: string): boolean {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function taskWorktreeRoot(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, ".harness", "worktrees", safeRefPart(taskId));
}

function isTaskHarnessWorktree(worktreePath: string, repoRoot: string, taskId: string): boolean {
  return isInside(worktreePath, taskWorktreeRoot(repoRoot, taskId));
}

function taskBranchPrefixes(taskId: string): string[] {
  const safeTaskId = safeRefPart(taskId);
  return [`harness/${safeTaskId}/`, `harness/${safeTaskId}`];
}

function taskIsExpiredBlocked(task: Task, nowMs: number): boolean {
  if (task.status !== "blocked") {
    return false;
  }
  return nowMs - Date.parse(task.updatedAt) >= BLOCKED_WORKTREE_TTL_MS;
}

function taskMatchesMode(task: Task, mode: WorktreeCleanupMode, nowMs: number): boolean {
  if (mode === "completed") {
    return task.status === "done";
  }
  if (mode === "failed") {
    return task.status === "blocked" || task.status === "needs_fix" || task.status === "canceled";
  }
  if (mode === "expired-blocked") {
    return taskIsExpiredBlocked(task, nowMs);
  }
  return !ACTIVE_STATUSES.has(task.status);
}

async function registeredWorktrees(repoRoot: string): Promise<RegisteredWorktree[]> {
  const output = await git(["worktree", "list", "--porcelain"], repoRoot);
  const worktrees: RegisteredWorktree[] = [];
  let current: RegisteredWorktree | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(current);
      }
      current = { path: path.resolve(line.slice("worktree ".length)), branchName: null };
    } else if (line.startsWith("branch ") && current) {
      current.branchName = line.slice("branch refs/heads/".length);
    }
  }
  if (current) {
    worktrees.push(current);
  }
  return worktrees;
}

async function harnessBranches(repoRoot: string): Promise<string[]> {
  const output = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads/harness"], repoRoot);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function removeRegisteredWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await git(["worktree", "remove", "--force", "--", worktreePath], repoRoot);
}

function removeDirectoryIfPresent(directoryPath: string, allowedRoot: string): boolean {
  const resolved = path.resolve(directoryPath);
  if (!fs.existsSync(resolved)) {
    return false;
  }
  if (!isInside(resolved, allowedRoot)) {
    throw new Error(`Refusing to remove path outside harness worktree root: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return true;
}

async function cleanupTask(repoRoot: string, task: Task, summary: WorktreeCleanupSummary): Promise<void> {
  const root = taskWorktreeRoot(repoRoot, task.id);
  const harnessWorktreeRoot = path.join(repoRoot, ".harness", "worktrees");
  const worktrees = await registeredWorktrees(repoRoot);
  for (const worktree of worktrees) {
    if (!isTaskHarnessWorktree(worktree.path, repoRoot, task.id)) {
      continue;
    }
    try {
      await removeRegisteredWorktree(repoRoot, worktree.path);
      summary.removedWorktrees.push(worktree.path);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    if (removeDirectoryIfPresent(root, harnessWorktreeRoot)) {
      summary.removedWorktrees.push(root);
    }
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  const prefixes = taskBranchPrefixes(task.id);
  const branches = await harnessBranches(repoRoot);
  for (const branch of branches) {
    if (!prefixes.some((prefix) => branch === prefix || branch.startsWith(prefix))) {
      continue;
    }
    try {
      await git(["branch", "-D", branch], repoRoot);
      summary.removedBranches.push(branch);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await git(["worktree", "prune"], repoRoot);
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }
}

async function cleanupOrphanWorktrees(repoRoot: string, activeTaskIds: Set<string>, summary: WorktreeCleanupSummary): Promise<void> {
  const harnessWorktreeRoot = path.join(repoRoot, ".harness", "worktrees");
  if (!fs.existsSync(harnessWorktreeRoot)) {
    return;
  }

  const worktrees = await registeredWorktrees(repoRoot);
  for (const worktree of worktrees) {
    if (!isInside(worktree.path, harnessWorktreeRoot)) {
      continue;
    }
    const relative = path.relative(harnessWorktreeRoot, worktree.path);
    const taskId = relative.split(path.sep)[0];
    if (activeTaskIds.has(taskId)) {
      continue;
    }
    try {
      await removeRegisteredWorktree(repoRoot, worktree.path);
      summary.removedWorktrees.push(worktree.path);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const entry of fs.readdirSync(harnessWorktreeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || activeTaskIds.has(entry.name)) {
      continue;
    }
    try {
      const directoryPath = path.join(harnessWorktreeRoot, entry.name);
      if (removeDirectoryIfPresent(directoryPath, harnessWorktreeRoot)) {
        summary.removedWorktrees.push(directoryPath);
      }
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

async function cleanupProjectBranches(repoRoot: string, tasks: Task[], summary: WorktreeCleanupSummary): Promise<void> {
  const protectedTaskIds = new Set(tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).map((task) => safeRefPart(task.id)));
  const branches = await harnessBranches(repoRoot);
  for (const branch of branches) {
    const match = /^harness\/([^/]+)/.exec(branch);
    if (match && protectedTaskIds.has(match[1])) {
      continue;
    }
    try {
      await git(["branch", "-D", branch], repoRoot);
      summary.removedBranches.push(branch);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

export async function cleanupWorktrees(input: {
  mode: WorktreeCleanupMode;
  tasks: Task[];
  projectPaths?: string[];
  excludeTaskIds?: string[];
  nowMs?: number;
}): Promise<WorktreeCleanupSummary> {
  const summary: WorktreeCleanupSummary = {
    mode: input.mode,
    removedWorktrees: [],
    removedBranches: [],
    skippedActiveTasks: [],
    errors: []
  };
  const nowMs = input.nowMs ?? Date.now();
  const excluded = new Set(input.excludeTaskIds || []);
  const taskProjectPaths = input.tasks.map((task) => task.targetProjectPath);
  const projectPaths = Array.from(new Set([...(input.projectPaths || []), ...taskProjectPaths].map((item) => path.resolve(item))));

  for (const projectPath of projectPaths) {
    if (!(await isGitRepository(projectPath))) {
      continue;
    }
    const repoRoot = await gitRoot(projectPath);
    const normalizedRepoRoot = path.resolve(repoRoot).toLowerCase();
    const projectTasks = input.tasks.filter(
      (task) => path.resolve(task.targetProjectPath).toLowerCase() === normalizedRepoRoot
    );
    const activeTaskIds = new Set(
      projectTasks.filter((task) => ACTIVE_STATUSES.has(task.status) || excluded.has(task.id)).map((task) => safeRefPart(task.id))
    );

    for (const task of projectTasks) {
      if (excluded.has(task.id) || ACTIVE_STATUSES.has(task.status)) {
        summary.skippedActiveTasks.push(task.id);
        continue;
      }
      if (!taskMatchesMode(task, input.mode, nowMs)) {
        continue;
      }
      await cleanupTask(repoRoot, task, summary);
    }

    if (input.mode === "all") {
      await cleanupOrphanWorktrees(repoRoot, activeTaskIds, summary);
      await cleanupProjectBranches(repoRoot, projectTasks, summary);
    }
  }

  summary.removedWorktrees = Array.from(new Set(summary.removedWorktrees));
  summary.removedBranches = Array.from(new Set(summary.removedBranches));
  summary.skippedActiveTasks = Array.from(new Set(summary.skippedActiveTasks));
  return summary;
}

export async function cleanupSingleTaskWorktrees(input: {
  task: Task;
  mode?: WorktreeCleanupMode;
}): Promise<WorktreeCleanupSummary> {
  return cleanupWorktrees({
    mode: input.mode || "all",
    tasks: [input.task],
    projectPaths: [input.task.targetProjectPath]
  });
}

export async function cleanupSpecificWorktree(input: {
  targetProjectPath: string;
  worktreePath: string;
  branchName?: string | null;
}): Promise<WorktreeCleanupSummary> {
  const summary: WorktreeCleanupSummary = {
    mode: "all",
    removedWorktrees: [],
    removedBranches: [],
    skippedActiveTasks: [],
    errors: []
  };
  if (!(await isGitRepository(input.targetProjectPath))) {
    return summary;
  }

  const repoRoot = await gitRoot(input.targetProjectPath);
  const harnessWorktreeRoot = path.join(repoRoot, ".harness", "worktrees");
  const worktreePath = path.resolve(input.worktreePath);
  if (!isInside(worktreePath, harnessWorktreeRoot)) {
    summary.errors.push(`Refusing to remove non-harness worktree: ${worktreePath}`);
    return summary;
  }

  try {
    await removeRegisteredWorktree(repoRoot, worktreePath);
    summary.removedWorktrees.push(worktreePath);
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    if (removeDirectoryIfPresent(worktreePath, harnessWorktreeRoot)) {
      summary.removedWorktrees.push(worktreePath);
    }
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  if (input.branchName?.startsWith("harness/")) {
    try {
      await git(["branch", "-D", input.branchName], repoRoot);
      summary.removedBranches.push(input.branchName);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await git(["worktree", "prune"], repoRoot);
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  summary.removedWorktrees = Array.from(new Set(summary.removedWorktrees));
  summary.removedBranches = Array.from(new Set(summary.removedBranches));
  return summary;
}
