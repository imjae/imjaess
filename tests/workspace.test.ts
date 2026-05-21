import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertInsideWorkspace } from "@/lib/shell";
import { createTaskWorkspace } from "@/lib/git";

describe("workspace isolation", () => {
  it("rejects cwd outside the task workspace", () => {
    expect(() => assertInsideWorkspace("C:\\repo\\task", "C:\\repo\\task\\src")).not.toThrow();
    expect(() => assertInsideWorkspace("C:\\repo\\task", "C:\\repo\\other")).toThrow();
  });

  it("creates a unique git worktree for a task", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-git-"));
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "harness@example.local"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: root });
    fs.writeFileSync(path.join(root, "README.md"), "test\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root });

    const workspace = await createTaskWorkspace("task-123", root);
    expect(workspace.kind).toBe("worktree");
    expect(workspace.path).toContain(path.join(".harness", "worktrees", "task-123"));
    expect(fs.existsSync(workspace.path)).toBe(true);
  });
});
