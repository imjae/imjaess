import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentRole } from "@/lib/types";
import { insertShellLog } from "@/lib/db";

const execAsync = promisify(exec);

export interface ShellResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function assertInsideWorkspace(workspacePath: string, cwd: string): void {
  const workspace = path.resolve(workspacePath);
  const resolvedCwd = path.resolve(cwd);
  const relative = path.relative(workspace, resolvedCwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Command cwd must stay inside task workspace. cwd=${resolvedCwd}`);
  }
}

export async function runShell(input: {
  taskId: string;
  agentRole: AgentRole;
  command: string;
  cwd: string;
  workspacePath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ShellResult> {
  const cwd = path.resolve(input.cwd);
  assertInsideWorkspace(input.workspacePath, cwd);
  const startedAt = Date.now();
  let exitCode: number | null = 0;
  let stdout = "";
  let stderr = "";

  try {
    const result = await execAsync(input.command, {
      cwd,
      shell: "powershell.exe",
      windowsHide: true,
      timeout: input.timeoutMs || 120_000,
      maxBuffer: 1024 * 1024 * 10,
      signal: input.signal
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
      signal?: string;
    };
    stdout = err.stdout || "";
    stderr = err.stderr || err.message;
    exitCode = typeof err.code === "number" ? err.code : null;
  }

  const shellResult: ShellResult = {
    command: input.command,
    cwd,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt
  };
  insertShellLog({
    taskId: input.taskId,
    agentRole: input.agentRole,
    ...shellResult
  });
  return shellResult;
}
