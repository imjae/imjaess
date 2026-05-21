import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
  return result.stdout.trim();
}

function safeRefPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

async function gitRoot(projectPath: string): Promise<string> {
  return git(["rev-parse", "--show-toplevel"], projectPath);
}

async function branchExists(root: string, branchName: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", branchName], root);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    const output = await git(["rev-parse", "--is-inside-work-tree"], projectPath);
    return output === "true";
  } catch {
    return false;
  }
}

export function integrationBranchName(): string {
  return process.env.HARNESS_INTEGRATION_BRANCH || "imjae";
}

export async function createTaskWorkspace(taskId: string, targetProjectPath: string): Promise<{
  path: string;
  kind: "worktree" | "direct";
  warning?: string;
}> {
  const projectPath = path.resolve(targetProjectPath);
  if (!(await isGitRepository(projectPath))) {
    return {
      path: projectPath,
      kind: "direct",
      warning: "Target path is not a git repository; using the project path directly."
    };
  }

  const root = await gitRoot(projectPath);
  const worktreeRoot = path.join(root, ".harness", "worktrees");
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const worktreePath = path.join(worktreeRoot, taskId);
  if (fs.existsSync(worktreePath)) {
    return { path: worktreePath, kind: "worktree" };
  }

  const branchName = `harness/${taskId}`;
  try {
    await git(["worktree", "add", "-b", branchName, worktreePath, "HEAD"], root);
  } catch (firstError) {
    try {
      await git(["worktree", "add", worktreePath, branchName], root);
    } catch {
      const message = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`Failed to create git worktree: ${message}`);
    }
  }
  return { path: worktreePath, kind: "worktree" };
}

export async function createAgentWorkspace(input: {
  taskId: string;
  role: string;
  round: number;
  targetProjectPath: string;
  baseRef?: string;
}): Promise<{
  path: string;
  kind: "worktree" | "direct";
  branchName: string | null;
  warning?: string;
}> {
  const projectPath = path.resolve(input.targetProjectPath);
  if (!(await isGitRepository(projectPath))) {
    return {
      path: projectPath,
      kind: "direct",
      branchName: null,
      warning: "Target path is not a git repository; using the project path directly."
    };
  }

  const root = await gitRoot(projectPath);
  const safeTaskId = safeRefPart(input.taskId);
  const safeRole = safeRefPart(input.role);
  const branchName = `harness/${safeTaskId}/${safeRole}/r${input.round}`;
  const worktreeRoot = path.join(root, ".harness", "worktrees", safeTaskId);
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const worktreePath = path.join(worktreeRoot, `r${input.round}-${safeRole}`);
  if (fs.existsSync(worktreePath)) {
    return { path: worktreePath, kind: "worktree", branchName };
  }

  const baseRef = input.baseRef || "HEAD";
  try {
    if (await branchExists(root, branchName)) {
      await git(["worktree", "add", worktreePath, branchName], root);
    } else {
      await git(["worktree", "add", "-b", branchName, worktreePath, baseRef], root);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create ${input.role} worktree: ${message}`);
  }

  return { path: worktreePath, kind: "worktree", branchName };
}

export async function getDiffSummary(workspacePath: string): Promise<string> {
  if (!(await isGitRepository(workspacePath))) {
    return "No git diff: workspace is not a git repository.";
  }
  try {
    const stat = await git(["diff", "--stat"], workspacePath);
    const names = await git(["diff", "--name-status"], workspacePath);
    return [stat, names].filter(Boolean).join("\n") || "No working tree changes.";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function commitWorkspaceChanges(workspacePath: string, message: string): Promise<{
  committed: boolean;
  ref: string;
  summary: string;
}> {
  if (!(await isGitRepository(workspacePath))) {
    return {
      committed: false,
      ref: workspacePath,
      summary: "No commit created: workspace is not a git repository."
    };
  }

  const status = await git(["status", "--porcelain"], workspacePath);
  const head = await git(["rev-parse", "HEAD"], workspacePath);
  if (!status.trim()) {
    return {
      committed: false,
      ref: head,
      summary: "No commit created: working tree has no changes."
    };
  }

  const summary = await getDiffSummary(workspacePath);
  await git(["add", "-A"], workspacePath);
  await git(["commit", "-m", message], workspacePath);
  const ref = await git(["rev-parse", "HEAD"], workspacePath);
  return {
    committed: true,
    ref,
    summary
  };
}

export async function ensureIntegrationWorkspace(targetProjectPath: string): Promise<{
  path: string;
  branchName: string;
  kind: "worktree" | "direct";
}> {
  const projectPath = path.resolve(targetProjectPath);
  if (!(await isGitRepository(projectPath))) {
    return {
      path: projectPath,
      branchName: integrationBranchName(),
      kind: "direct"
    };
  }

  const root = await gitRoot(projectPath);
  const branchName = integrationBranchName();
  const integrationPath = path.join(root, ".harness", "integration", safeRefPart(branchName));
  if (fs.existsSync(integrationPath)) {
    return { path: integrationPath, branchName, kind: "worktree" };
  }

  fs.mkdirSync(path.dirname(integrationPath), { recursive: true });
  if (!(await branchExists(root, branchName))) {
    await git(["branch", branchName, "HEAD"], root);
  }

  try {
    await git(["worktree", "add", integrationPath, branchName], root);
    return { path: integrationPath, branchName, kind: "worktree" };
  } catch (error) {
    const currentBranch = await git(["branch", "--show-current"], root);
    if (currentBranch === branchName) {
      return { path: root, branchName, kind: "direct" };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create integration worktree for ${branchName}: ${message}`);
  }
}

export async function mergeIntoIntegration(input: {
  targetProjectPath: string;
  sourceRef: string;
  taskId: string;
}): Promise<{
  path: string;
  branchName: string;
  output: string;
}> {
  const workspace = await ensureIntegrationWorkspace(input.targetProjectPath);
  if (!(await isGitRepository(workspace.path))) {
    return {
      path: workspace.path,
      branchName: workspace.branchName,
      output: "No merge performed: target project is not a git repository."
    };
  }

  await git(["merge", "--no-ff", input.sourceRef, "-m", `Merge harness task ${input.taskId}`], workspace.path);
  const head = await git(["rev-parse", "--short", "HEAD"], workspace.path);
  return {
    path: workspace.path,
    branchName: workspace.branchName,
    output: `Merged ${input.sourceRef} into ${workspace.branchName} at ${head}.`
  };
}
