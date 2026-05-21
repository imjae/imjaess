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

export async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    const output = await git(["rev-parse", "--is-inside-work-tree"], projectPath);
    return output === "true";
  } catch {
    return false;
  }
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

  const root = await git(["rev-parse", "--show-toplevel"], projectPath);
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
