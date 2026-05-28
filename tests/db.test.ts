import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTask,
  createConventionNote,
  deleteTask,
  deleteTaskTag,
  getProjectByPath,
  getTaskDetail,
  getDb,
  getNotionSettings,
  insertBrokerArtifact,
  insertShellLog,
  insertTaskAttachment,
  listTaskAttachments,
  listConventionNotes,
  listTaskGroups,
  listTaskTags,
  replaceTaskTags,
  resetDbForTests,
  updateNotionSettings,
  updateTask,
  upsertImportedTask,
  upsertProject
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
    expect(detail?.planningMode).toBe("direct");
    expect(detail?.verificationMode).toBe("fast");
    expect(detail?.currentRound).toBe(1);
    expect(detail?.shellLogs[0]?.command).toBe("echo ok");
    expect(detail?.shellLogs[0]?.exitCode).toBe(0);
  });

  it("stores balanced verification mode when requested", () => {
    const task = createTask({
      title: "Strict task",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      verificationMode: "balanced",
      approvalGrant: true
    });

    expect(getTaskDetail(task.id)?.verificationMode).toBe("balanced");
  });

  it("stores plan mode when requested", () => {
    const task = createTask({
      title: "Plan task",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      planningMode: "plan",
      approvalGrant: true
    });

    expect(getTaskDetail(task.id)?.planningMode).toBe("plan");
  });

  it("stores structured broker artifact contracts with legacy content", () => {
    const task = createTask({
      title: "Contract task",
      goal: "Goal",
      scope: "Scope",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });

    insertBrokerArtifact({
      taskId: task.id,
      round: 1,
      sourceRole: "broker",
      kind: "implementation_brief",
      content: "Legacy summary",
      contract: {
        version: "1",
        kind: "implementation_brief",
        summary: "Structured summary",
        claims: [{ id: "claim-1", text: "Claim", confidence: "high", evidenceIds: ["ev-1"] }],
        evidence: [{ id: "ev-1", type: "diff", reference: "git diff", excerpt: "diff --git" }],
        filesTouched: ["lib/example.ts"],
        commandsRun: [],
        unverifiedAssumptions: [],
        residualRisks: [],
        acceptanceCriteriaStatus: [{ criterion: "Diff captured", status: "pass", evidenceIds: ["ev-1"] }]
      }
    });

    const artifact = getTaskDetail(task.id)?.brokerArtifacts[0];
    expect(artifact?.content).toBe("Legacy summary");
    expect(artifact?.contract?.summary).toBe("Structured summary");
    expect(artifact?.contract?.claims[0]?.evidenceIds).toEqual(["ev-1"]);
  });

  it("stores convention notes by rule target", () => {
    createConventionNote({
      projectPath: "C:\\repo",
      ruleTarget: "research_planning",
      category: "Agent flow",
      rule: "조사 근거를 먼저 확인한다.",
      reason: "계획 편향을 줄이기 위해서다.",
      source: "manual",
      confidence: "high",
      examples: ""
    });
    createConventionNote({
      projectPath: "C:\\repo",
      ruleTarget: "implementation",
      category: "Code",
      rule: "변경 범위를 좁게 유지한다.",
      reason: "",
      source: "manual",
      confidence: "medium",
      examples: ""
    });

    expect(listConventionNotes("C:\\repo").map((note) => note.ruleTarget)).toEqual([
      "implementation",
      "research_planning"
    ]);
  });

  it("can clear a saved project verification command", () => {
    upsertProject({
      path: "C:\\repo",
      verificationCommand: "dotnet build Deluge.sln --no-restore"
    });
    upsertProject({
      path: "C:\\repo",
      verificationCommand: null
    });

    expect(getProjectByPath("C:\\repo")?.verificationCommand).toBeNull();
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

  it("upserts imported Notion tasks with stable IDs and parent links", () => {
    upsertImportedTask({
      id: "parent-task",
      title: "Imported parent",
      goal: "Restore parent",
      scope: "@Assets",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true,
      status: "done",
      currentRound: 1,
      taskTags: ["Graphic"],
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:01:00.000Z",
      notionPageId: "notion-parent",
      notionUrl: "https://notion.local/parent"
    });
    upsertImportedTask({
      id: "child-task",
      parentTaskId: "parent-task",
      title: "Imported child",
      goal: "Restore child",
      scope: "",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: false,
      status: "blocked",
      currentRound: 2,
      taskTags: ["Graphic", "Follow-up"],
      failureReason: "Needs manual check",
      notionPageId: "notion-child",
      notionUrl: null,
      verificationCommand: "npm test"
    });

    const parent = getTaskDetail("parent-task");
    const child = getTaskDetail("child-task");
    expect(parent?.childTasks.map((task) => task.id)).toEqual(["child-task"]);
    expect(child?.parentTaskId).toBe("parent-task");
    expect(child?.tags).toEqual(["Follow-up", "Graphic"]);
    expect(child?.notionSync?.notionPageId).toBe("notion-child");
  });

  it("stores Notion task database ids with settings", () => {
    updateNotionSettings({
      parentPageId: "parent",
      databaseId: "database",
      dataSourceId: "data-source"
    });

    expect(getNotionSettings()).toMatchObject({
      parentPageId: "parent",
      databaseId: "database",
      dataSourceId: "data-source"
    });

    updateNotionSettings({ parentPageId: "other-parent" });
    expect(getNotionSettings()).toMatchObject({
      parentPageId: "other-parent",
      databaseId: null,
      dataSourceId: null
    });
  });
});
