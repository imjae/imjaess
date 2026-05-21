import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTask,
  deleteTask,
  getTaskDetail,
  insertShellLog,
  insertTaskAttachment,
  listTaskAttachments,
  listTaskGroups,
  resetDbForTests,
  updateTask
} from "@/lib/db";

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
      taskGroup: "Effects",
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
    expect(detail?.taskGroup).toBe("Effects");
    expect(detail?.currentRound).toBe(1);
    expect(detail?.shellLogs[0]?.command).toBe("echo ok");
    expect(detail?.shellLogs[0]?.exitCode).toBe(0);
  });

  it("records image attachments for task details", () => {
    const task = createTask({
      title: "Attach image",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });

    const attachment = insertTaskAttachment({
      taskId: task.id,
      originalName: "preview.png",
      storedPath: "C:\\tmp\\preview.png",
      mimeType: "image/png",
      sizeBytes: 4096
    });

    expect(listTaskAttachments(task.id).map((item) => item.id)).toEqual([attachment.id]);
    expect(getTaskDetail(task.id)?.attachments[0]?.originalName).toBe("preview.png");
  });

  it("keeps used task groups as selectable tags after task deletion", () => {
    const task = createTask({
      title: "Grouped task",
      taskGroup: "Game Logic",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });

    expect(listTaskGroups().map((group) => group.name)).toContain("Game Logic");
    expect(deleteTask(task.id)).toBe(true);
    expect(listTaskGroups().map((group) => group.name)).toContain("Game Logic");
  });

  it("deletes a task and cascades related task records", () => {
    const task = createTask({
      title: "Delete me",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });
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

    expect(deleteTask(task.id)).toBe(true);
    expect(getTaskDetail(task.id)).toBeNull();
  });

  it("tracks follow-up child tasks", () => {
    const parent = createTask({
      title: "Parent",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });
    const child = createTask({
      parentTaskId: parent.id,
      title: "Follow-up",
      goal: "Continue",
      scope: "",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: false
    });

    const detail = getTaskDetail(parent.id);
    expect(detail?.childTasks.map((task) => task.id)).toEqual([child.id]);
    expect(getTaskDetail(child.id)?.parentTaskId).toBe(parent.id);
  });
});
