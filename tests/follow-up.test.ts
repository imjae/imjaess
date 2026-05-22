import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTask,
  getProjectByPath,
  getTaskDetail,
  insertBrokerArtifact,
  insertVerification,
  resetDbForTests,
  upsertProject
} from "@/lib/db";
import { createFollowUpTask } from "@/lib/follow-up";

describe("follow-up tasks", () => {
  beforeEach(() => {
    process.env.HARNESS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "harness-follow-up-")), "test.sqlite");
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    delete process.env.HARNESS_DB_PATH;
  });

  it("creates a child task with parent summary context", () => {
    const parent = createTask({
      title: "Fix trade UI",
      taskGroup: "Game Logic",
      taskTags: ["Game Logic", "UI"],
      goal: "Fix price display",
      scope: "@Assets/Scripts/UI/Trade",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: true
    });
    insertBrokerArtifact({
      taskId: parent.id,
      round: 1,
      sourceRole: "verifier",
      kind: "final_brief",
      content: "Parent verifier summary."
    });
    insertVerification({
      taskId: parent.id,
      round: 1,
      decision: "needs_fix",
      summary: "Needs one more check.",
      command: "npm test",
      exitCode: 1
    });

    const followUp = createFollowUpTask({
      parentTaskId: parent.id,
      message: "Continue from the remaining verifier issue.",
      approvalGrant: false
    });

    expect(followUp.parentTaskId).toBe(parent.id);
    expect(followUp.taskGroup).toBe("Game Logic");
    expect(followUp.tags).toEqual(["Game Logic", "UI"]);
    expect(followUp.goal).toContain("Continue from the remaining verifier issue.");
    expect(followUp.goal).toContain("Parent verifier summary.");
    expect(getTaskDetail(parent.id)?.childTasks[0]?.id).toBe(followUp.id);
  });

  it("keeps legacy dotnet verification for follow-up tasks", () => {
    const parent = createTask({
      title: "Validate Unity effect",
      taskGroup: "Graphic",
      taskTags: ["Graphic"],
      goal: "Validate effect setup",
      scope: "@Assets",
      targetProjectPath: "C:\\repo",
      agentPlan: "Plan",
      approvalGrant: false
    });
    upsertProject({
      path: path.resolve("C:\\repo"),
      verificationCommand: "dotnet build Deluge.sln --no-restore"
    });

    createFollowUpTask({
      parentTaskId: parent.id,
      message: "Re-run validation.",
      approvalGrant: false
    });

    expect(getProjectByPath(path.resolve("C:\\repo"))?.verificationCommand).toBe("dotnet build Deluge.sln --no-restore");
  });
});
