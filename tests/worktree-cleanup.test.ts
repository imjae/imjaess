import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "@/lib/types";
import { cleanupSingleTaskWorktrees, cleanupWorktrees } from "@/lib/worktree-cleanup";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cleanup-"));
  git(["init"], root);
  git(["config", "user.email", "harness@example.local"], root);
  git(["config", "user.name", "Harness Test"], root);
  fs.writeFileSync(path.join(root, "README.md"), "base\n");
  git(["add", "README.md"], root);
  git(["commit", "-m", "init"], root);
  return root;
}

function task(input: { id: string; root: string; status: TaskStatus; updatedAt?: string }): Task {
  const timestamp = input.updatedAt || new Date().toISOString();
  return {
    id: input.id,
    parentTaskId: null,
    taskGroup: "",
    tags: [],
    title: input.id,
    goal: "goal",
    scope: "",
    targetProjectPath: input.root,
    worktreePath: null,
    agentPlan: "",
    planningMode: "direct",
    verificationMode: "fast",
    approvalGrant: true,
    status: input.status,
    currentRound: 1,
    failureReason: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function addWorktree(root: string, taskId: string, role = "implementer"): string {
  const worktreePath = path.join(root, ".harness", "worktrees", taskId, `r1-${role}`);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(["worktree", "add", "-b", `harness/${taskId}/${role}/r1`, worktreePath, "HEAD"], root);
  return worktreePath;
}

describe("worktree cleanup", () => {
  it("removes completed task worktrees and branches without deleting task records", async () => {
    const root = initRepo();
    const worktreePath = addWorktree(root, "task-done");
    const summary = await cleanupSingleTaskWorktrees({
      task: task({ id: "task-done", root, status: "done" })
    });

    expect(summary.errors).toEqual([]);
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(git(["branch", "--list", "harness/task-done/*"], root)).toBe("");
  });

  it("keeps active worktrees during all cleanup", async () => {
    const root = initRepo();
    const activeWorktree = addWorktree(root, "task-running");
    const doneWorktree = addWorktree(root, "task-done");

    const summary = await cleanupWorktrees({
      mode: "all",
      tasks: [
        task({ id: "task-running", root, status: "running" }),
        task({ id: "task-done", root, status: "done" })
      ],
      projectPaths: [root]
    });

    expect(summary.skippedActiveTasks).toContain("task-running");
    expect(fs.existsSync(activeWorktree)).toBe(true);
    expect(fs.existsSync(doneWorktree)).toBe(false);
  });

  it("removes review-ready worktrees but preserves review branches", async () => {
    const root = initRepo();
    const worktreePath = addWorktree(root, "task-review");
    git(["branch", "harness/review/task-review", "HEAD"], root);

    const summary = await cleanupSingleTaskWorktrees({
      task: task({ id: "task-review", root, status: "ready_for_review" })
    });

    expect(summary.errors).toEqual([]);
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(git(["branch", "--list", "harness/task-review/*"], root)).toBe("");
    expect(git(["branch", "--list", "harness/review/task-review"], root)).toContain("harness/review/task-review");
  });

  it("preserves review branches during all cleanup", async () => {
    const root = initRepo();
    git(["branch", "harness/review/orphan-task", "HEAD"], root);
    git(["branch", "harness/orphan-task/implementer/r1", "HEAD"], root);

    const summary = await cleanupWorktrees({
      mode: "all",
      tasks: [],
      projectPaths: [root]
    });

    expect(summary.errors).toEqual([]);
    expect(git(["branch", "--list", "harness/review/orphan-task"], root)).toContain("harness/review/orphan-task");
    expect(git(["branch", "--list", "harness/orphan-task/implementer/r1"], root)).toBe("");
  });

  it("removes only expired blocked worktrees for TTL cleanup", async () => {
    const root = initRepo();
    const oldBlockedWorktree = addWorktree(root, "task-old");
    const newBlockedWorktree = addWorktree(root, "task-new");
    const now = Date.now();

    await cleanupWorktrees({
      mode: "expired-blocked",
      tasks: [
        task({ id: "task-old", root, status: "blocked", updatedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }),
        task({ id: "task-new", root, status: "blocked", updatedAt: new Date(now - 60 * 60 * 1000).toISOString() })
      ],
      projectPaths: [root],
      nowMs: now
    });

    expect(fs.existsSync(oldBlockedWorktree)).toBe(false);
    expect(fs.existsSync(newBlockedWorktree)).toBe(true);
  });
});
