import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTask, getTaskDetail, insertShellLog, resetDbForTests, updateTask } from "@/lib/db";

describe("task persistence", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "harness-db-")), "test.sqlite");
    process.env.HARNESS_DB_PATH = dbPath;
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    delete process.env.HARNESS_DB_PATH;
  });

  it("records task state transitions and shell logs", () => {
    const task = createTask({
      title: "Test",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });
    updateTask(task.id, { status: "running", currentRound: 1 });
    insertShellLog({
      taskId: task.id,
      agentRole: "verifier",
      command: "echo ok",
      cwd: "C:\\repo",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 12
    });

    const detail = getTaskDetail(task.id);
    expect(detail?.status).toBe("running");
    expect(detail?.currentRound).toBe(1);
    expect(detail?.shellLogs[0]?.command).toBe("echo ok");
    expect(detail?.shellLogs[0]?.exitCode).toBe(0);
  });
});
