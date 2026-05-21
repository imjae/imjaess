import { describe, expect, it } from "vitest";
import { taskReportMarkdown } from "@/lib/task-report";
import type { TaskDetail } from "@/lib/types";

describe("taskReportMarkdown", () => {
  it("uses broker artifacts and verifier decisions for the shared report", () => {
    const task: TaskDetail = {
      id: "task-1",
      title: "Fix inventory",
      goal: "Fix the inventory bug.",
      scope: "Keep UI changes narrow.",
      targetProjectPath: "D:\\dev\\Deluge",
      worktreePath: "D:\\dev\\Deluge\\.harness\\task-1",
      agentPlan: "",
      approvalGrant: true,
      status: "done",
      currentRound: 1,
      failureReason: null,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:01:00.000Z",
      agentRuns: [
        {
          id: "run-1",
          taskId: "task-1",
          role: "researcher",
          provider: "openai",
          model: "gpt-5.5",
          round: 1,
          status: "done",
          contextBudgetChars: 12000,
          timeBudgetMs: 300000,
          inputChars: 100,
          outputChars: 200,
          wasTrimmed: false,
          timedOut: false,
          input: "private input",
          output: "private raw output",
          error: null,
          startedAt: "2026-05-21T00:00:00.000Z",
          finishedAt: "2026-05-21T00:00:10.000Z"
        }
      ],
      shellLogs: [],
      brokerArtifacts: [
        {
          id: "artifact-1",
          taskId: "task-1",
          round: 1,
          sourceRole: "researcher",
          kind: "evidence_pack",
          content: "Approved evidence",
          createdAt: "2026-05-21T00:00:10.000Z"
        }
      ],
      verifications: [
        {
          id: "verification-1",
          taskId: "task-1",
          round: 1,
          decision: "pass",
          summary: "Passed verification.",
          command: "npm test",
          exitCode: 0,
          createdAt: "2026-05-21T00:01:00.000Z"
        }
      ],
      notionSync: null
    };

    const markdown = taskReportMarkdown(task);
    expect(markdown).toContain("# Task: Fix inventory");
    expect(markdown).toContain("Approved evidence");
    expect(markdown).toContain("Passed verification.");
    expect(markdown).not.toContain("private raw output");
  });
});
