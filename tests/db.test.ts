import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTask,
  deleteTask,
  deleteTaskTag,
  getTaskDetail,
  getDb,
  insertShellLog,
  insertTaskAttachment,
  listTaskAttachments,
  listTaskGroups,
  listTaskTags,
  replaceTaskTags,
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
    expect(detail?.tags).toEqual(["Effects"]);
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

  it("keeps used task tags after task deletion", () => {
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
    expect(listTaskTags().map((tag) => tag.name)).toContain("Game Logic");
    expect(deleteTask(task.id)).toBe(true);
    expect(listTaskGroups().map((group) => group.name)).toContain("Game Logic");
    expect(listTaskTags().map((tag) => tag.name)).toContain("Game Logic");
    expect(
      getDb()
        .prepare("SELECT COUNT(*) AS count FROM task_tag_links WHERE task_id = ?")
        .get(task.id) as { count: number }
    ).toEqual({ count: 0 });
  });

  it("stores multiple task tags and removes duplicate entries", () => {
    const task = createTask({
      title: "Tagged task",
      taskTags: ["Graphic", "Shader", "Graphic", " "],
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });

    const detail = getTaskDetail(task.id);
    expect(detail?.taskGroup).toBe("Graphic");
    expect(detail?.tags).toEqual(["Graphic", "Shader"]);
    expect(listTaskTags().map((tag) => tag.name)).toEqual(["Graphic", "Shader"]);
  });

  it("updates task tags for an existing task", () => {
    const task = createTask({
      title: "Retag task",
      taskGroup: "Graphic",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });

    expect(replaceTaskTags(task.id, ["Shader", "VFX", "Shader"])).toEqual(["Shader", "VFX"]);
    const detail = getTaskDetail(task.id);
    expect(detail?.taskGroup).toBe("Shader");
    expect(detail?.tags).toEqual(["Shader", "VFX"]);
  });

  it("deletes a task tag globally without deleting tasks", () => {
    const first = createTask({
      title: "Tagged task",
      taskTags: ["Graphic", "Shader"],
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });
    const second = createTask({
      title: "Only graphic",
      taskTags: ["Graphic"],
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });

    expect(deleteTaskTag("Graphic")).toBe(true);
    expect(listTaskTags().map((tag) => tag.name)).toEqual(["Shader"]);
    expect(getTaskDetail(first.id)?.tags).toEqual(["Shader"]);
    expect(getTaskDetail(first.id)?.taskGroup).toBe("Shader");
    expect(getTaskDetail(second.id)?.tags).toEqual([]);
    expect(getTaskDetail(second.id)?.taskGroup).toBe("");
  });

  it("migrates legacy task_group values into task tags", () => {
    const database = getDb();
    database
      .prepare(
        `INSERT INTO tasks
        (id, parent_task_id, task_group, title, goal, scope, target_project_path, worktree_path, agent_plan, approval_grant, status, current_round, failure_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "legacy-task",
        null,
        "Graphic",
        "Legacy",
        "Goal",
        "",
        "C:\\repo",
        null,
        "Plan",
        1,
        "queued",
        0,
        null,
        "2026-05-22T00:00:00.000Z",
        "2026-05-22T00:00:00.000Z"
      );
    resetDbForTests();

    expect(getTaskDetail("legacy-task")?.tags).toEqual(["Graphic"]);
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
