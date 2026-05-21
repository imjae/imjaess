import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertInsideWorkspace } from "@/lib/shell";
import { createAgentWorkspace, createTaskWorkspace, mergeIntoIntegration } from "@/lib/git";

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

  it("creates role worktrees and merges passing implementation into the integration branch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-flow-"));
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "harness@example.local"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: root });
    fs.writeFileSync(path.join(root, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root });

    const implementer = await createAgentWorkspace({
      taskId: "task-456",
      role: "implementer",
      round: 1,
      targetProjectPath: root
    });
    expect(implementer.path).toContain(path.join(".harness", "worktrees", "task-456", "r1-implementer"));
    expect(implementer.branchName).toBe("harness/task-456/implementer/r1");

    fs.writeFileSync(path.join(implementer.path, "README.md"), "changed\n");
    execFileSync("git", ["add", "README.md"], { cwd: implementer.path });
    execFileSync("git", ["commit", "-m", "change"], { cwd: implementer.path });

    const merge = await mergeIntoIntegration({
      targetProjectPath: root,
      sourceRef: implementer.branchName || "HEAD",
      taskId: "task-456"
    });

    expect(merge.branchName).toBe("imjae");
    expect(fs.readFileSync(path.join(merge.path, "README.md"), "utf8").replace(/\r\n/g, "\n")).toBe("changed\n");
  });
});
