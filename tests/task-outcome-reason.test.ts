import { describe, expect, it } from "vitest";
import { deriveTaskOutcomeReason } from "@/lib/task-outcome-reason";
import type { TaskDetail, TaskStatus, Verification } from "@/lib/types";

function taskDetail(input: Partial<TaskDetail> & { status: TaskStatus }): TaskDetail {
  return {
    id: "task-1",
    parentTaskId: null,
    taskGroup: "default",
    tags: [],
    title: "Task",
    goal: "Goal",
    scope: "",
    targetProjectPath: "D:\\repo",
    baseBranch: null,
    worktreePath: null,
    agentPlan: "",
    planningMode: "direct",
    verificationMode: "fast",
    approvalGrant: true,
    currentRound: 1,
    failureReason: null,
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    childTasks: [],
    attachments: [],
    agentRuns: [],
    shellLogs: [],
    verifications: [],
    brokerArtifacts: [],
    notionSync: null,
    ...input
  };
}

function verification(input: Partial<Verification> & { decision: Verification["decision"]; summary: string }): Verification {
  return {
    id: "verification-1",
    taskId: "task-1",
    round: 1,
    command: null,
    exitCode: null,
    createdAt: "2026-05-29T00:00:03.000Z",
    ...input
  };
}

describe("deriveTaskOutcomeReason", () => {
  it("explains ready_for_review as a manual review gate, not a silent incomplete state", () => {
    const reason = deriveTaskOutcomeReason(
      taskDetail({
        status: "ready_for_review",
        verifications: [verification({ decision: "pass", summary: "Verifier passed from diff and tests." })],
        brokerArtifacts: [
          {
            id: "artifact-1",
            taskId: "task-1",
            round: 1,
            sourceRole: "verifier",
            kind: "final_brief",
            content: "READY FOR REVIEW\nCheckout: git checkout harness/review/task-1",
            contract: null,
            createdAt: "2026-05-29T00:00:04.000Z"
          }
        ]
      })
    );

    expect(reason?.kind).toBe("review_gate");
    expect(reason?.source).toBe("verifier");
    expect(reason?.summary).toContain("Verifier passed");
    expect(reason?.detail).toContain("READY FOR REVIEW");
  });

  it("uses the verifier summary when a blocked task has no stored failure reason", () => {
    const reason = deriveTaskOutcomeReason(
      taskDetail({
        status: "blocked",
        verifications: [verification({ decision: "blocked", summary: "Missing required workspace evidence." })]
      })
    );

    expect(reason?.kind).toBe("blocked");
    expect(reason?.source).toBe("verifier");
    expect(reason?.summary).toBe("Missing required workspace evidence.");
  });

  it("keeps the persisted failure reason as the primary needs_fix cause", () => {
    const reason = deriveTaskOutcomeReason(
      taskDetail({
        status: "needs_fix",
        failureReason: "Shell verification failed with exit 7.",
        verifications: [verification({ decision: "needs_fix", summary: "Verifier requested another round." })]
      })
    );

    expect(reason?.kind).toBe("needs_fix");
    expect(reason?.source).toBe("task");
    expect(reason?.summary).toBe("Shell verification failed with exit 7.");
  });
});
