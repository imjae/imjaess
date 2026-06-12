import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConventionNote,
  createTask,
  getTaskDetail,
  insertBrokerArtifact,
  resetDbForTests,
  upsertProject
} from "@/lib/db";
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

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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
    delete process.env.MAX_AGENT_ROUNDS;
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
    expect(detail?.status).toBe("ready_for_review");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "verifier"]);
    expect(detail?.brokerArtifacts.some((artifact) => artifact.kind === "test_result")).toBe(false);
    expect(detail?.brokerArtifacts.find((artifact) => artifact.kind === "evidence_pack")?.contract?.claims.length).toBeGreaterThan(0);
    expect(detail?.brokerArtifacts.find((artifact) => artifact.kind === "implementation_brief")?.contract?.evidence[0]?.type).toBe("diff");
    expect(detail?.brokerArtifacts.find((artifact) => artifact.kind === "final_brief")?.contract?.claims[0]?.text).toContain(
      "Verifier decision is pass"
    );
    expect(git(["branch", "--list", `harness/review/${task.id}`], root)).toContain(`harness/review/${task.id}`);
    expect(git(["branch", "--list", "imjae"], root)).toBe("");
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
    expect(detail?.status).toBe("ready_for_review");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "tester", "verifier"]);
    expect(detail?.brokerArtifacts.some((artifact) => artifact.kind === "test_result")).toBe(true);
    expect(detail?.brokerArtifacts.find((artifact) => artifact.kind === "test_result")?.contract?.evidence[0]?.type).toBe("test");
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
    const finalBrief = detail?.brokerArtifacts.find((artifact) => artifact.kind === "final_brief");
    expect(detail?.status).toBe("ready_for_review");
    expect(detail?.worktreePath).toBe(root);
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "verifier"]);
    expect(detail?.shellLogs[0]?.agentRole).toBe("verifier");
    expect(detail?.verifications[0]?.command).toBe("Write-Output ok");
    expect(finalBrief?.content).toContain("READY FOR REVIEW");
    expect(finalBrief?.content).toContain(`git checkout harness/review/${task.id}`);
    expect(git(["branch", "--list", "imjae"], root)).toBe("");
  });

  it("downgrades verifier pass when shell verification fails", async () => {
    process.env.MAX_AGENT_ROUNDS = "1";
    const root = createGitRepo();
    upsertProject({
      path: root,
      verificationCommand: "exit 7"
    });
    const task = createTask({
      title: "Failing shell validation",
      goal: "Do not pass failed shell evidence",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      verificationMode: "fast",
      approvalGrant: true
    });

    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    const finalBrief = detail?.brokerArtifacts.find((artifact) => artifact.kind === "final_brief");
    expect(detail?.status).toBe("blocked");
    expect(detail?.verifications[0]?.decision).toBe("needs_fix");
    expect(finalBrief?.content).toContain("downgraded by the evidence contract guardrail");
    expect(finalBrief?.contract?.acceptanceCriteriaStatus.some((criterion) => criterion.status === "fail")).toBe(true);
  });

  it("applies convention rules to the selected agents", async () => {
    const root = createGitRepo();
    createConventionNote({
      projectPath: root,
      agentTargets: ["researcher"],
      category: "Agent flow",
      rule: "계획 전에 실제 코드 흐름을 먼저 확인한다.",
      reason: "",
      source: "manual",
      confidence: "high",
      examples: ""
    });
    createConventionNote({
      projectPath: root,
      agentTargets: ["implementer"],
      category: "Code",
      rule: "구현 변경은 확인된 파일로 좁게 제한한다.",
      reason: "",
      source: "manual",
      confidence: "high",
      examples: ""
    });
    createConventionNote({
      projectPath: root,
      agentTargets: ["verifier"],
      category: "Review",
      rule: "Verifier-specific rule",
      reason: "",
      source: "manual",
      confidence: "high",
      examples: ""
    });
    const task = createTask({
      title: "Rule-guided task",
      goal: "Apply rules",
      scope: "",
      targetProjectPath: root,
      agentPlan: "Plan",
      verificationMode: "fast",
      approvalGrant: true
    });

    await processTask(task.id);

    const detail = getTaskDetail(task.id);
    expect(detail?.agentRuns.find((run) => run.role === "researcher")?.input).toContain(
      "계획 전에 실제 코드 흐름을 먼저 확인한다."
    );
    expect(detail?.agentRuns.find((run) => run.role === "implementer")?.input).toContain(
      "구현 변경은 확인된 파일로 좁게 제한한다."
    );
    expect(detail?.agentRuns.find((run) => run.role === "verifier")?.input).toContain("Verifier-specific rule");
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
    const plannerQuestions = detail?.brokerArtifacts.find((artifact) => artifact.kind === "plan_questions");
    expect(detail?.status).toBe("waiting_for_user");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher"]);
    expect(plannerQuestions?.sourceRole).toBe("researcher");
    expect(plannerQuestions?.content).toContain("브로커 조사/계획 질문");
    expect(plannerQuestions?.content).toContain("질문:");
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
    const planBrief = detail?.brokerArtifacts.find((artifact) => artifact.kind === "plan_brief");
    expect(detail?.status).toBe("ready_for_review");
    expect(detail?.agentRuns.map((run) => run.role)).toEqual(["researcher", "implementer", "verifier"]);
    expect(planBrief?.content).toContain("브로커 구현 계획 요약");
    expect(planBrief?.content).toContain("사용자 답변:");
  });
});
