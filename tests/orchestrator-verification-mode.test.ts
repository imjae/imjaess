import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTask, getTaskDetail, insertBrokerArtifact, resetDbForTests, upsertProject } from "@/lib/db";
import { processTask } from "@/lib/orchestrator";

function createGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestrator-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "harness@example.local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Harness Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

describe("orchestrator verification modes", () => {
  beforeEach(() => {
    process.env.HARNESS_DB_PATH = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestrator-db-")),
      "test.sqlite"
    );
    process.env.MOCK_AGENTS = "1";
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    delete process.env.HARNESS_DB_PATH;
    delete process.env.MOCK_AGENTS;
  });

  it("skips the tester agent in fast mode", async () => {
    const root = createGitRepo();
    const task = createTask({
      title: "Fast validation",
      goal: "Validate quickly",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      verificationMode: "fast",
      approvalGrant: true
    });

    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    expect(detail?.status).toBe("done");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "verifier"]);
    expect(detail?.brokerArtifacts.some((artifact) => artifact.kind === "test_result")).toBe(false);
  });

  it("keeps the tester agent in balanced mode", async () => {
    const root = createGitRepo();
    const task = createTask({
      title: "Balanced validation",
      goal: "Validate strictly",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      verificationMode: "balanced",
      approvalGrant: true
    });

    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    expect(detail?.status).toBe("done");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "tester", "verifier"]);
    expect(detail?.brokerArtifacts.some((artifact) => artifact.kind === "test_result")).toBe(true);
  });

  it("runs explicit shell verification as verifier evidence in fast mode", async () => {
    const root = createGitRepo();
    upsertProject({
      path: root,
      verificationCommand: "Write-Output ok"
    });
    const task = createTask({
      title: "Fast shell validation",
      goal: "Validate quickly with shell evidence",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      verificationMode: "fast",
      approvalGrant: true
    });

    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "verifier"]);
    expect(detail?.shellLogs[0]?.agentRole).toBe("verifier");
    expect(detail?.verifications[0]?.command).toBe("Write-Output ok");
  });

  it("pauses plan-mode tasks for user answers before implementation", async () => {
    const root = createGitRepo();
    const task = createTask({
      title: "Plan before implementation",
      goal: "Ask questions first",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      planningMode: "plan",
      verificationMode: "fast",
      approvalGrant: true
    });

    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    expect(detail?.status).toBe("waiting_for_user");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "planner"]);
    expect(detail?.brokerArtifacts.some((artifact) => artifact.kind === "plan_questions")).toBe(true);
    expect(detail?.agentRuns.some((run) => run.role === "implementer")).toBe(false);
  });

  it("resumes plan-mode tasks after a planner answer", async () => {
    const root = createGitRepo();
    const task = createTask({
      title: "Resume after planning",
      goal: "Use a user-approved plan",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      planningMode: "plan",
      verificationMode: "fast",
      approvalGrant: true
    });

    await processTask(task.id);
    insertBrokerArtifact({
      taskId: task.id,
      round: 1,
      sourceRole: "broker",
      kind: "plan_answer",
      content: "Preserve existing behavior and keep the implementation narrow."
    });
    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    expect(detail?.status).toBe("done");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "planner", "implementer", "verifier"]);
    expect(detail?.brokerArtifacts.some((artifact) => artifact.kind === "plan_brief")).toBe(true);
  });
});
