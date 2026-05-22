import { processTask } from "@/lib/orchestrator";
import { listProjects, listTasks } from "@/lib/db";
import { cleanupWorktrees } from "@/lib/worktree-cleanup";

type QueueState = {
  queue: string[];
  running: Set<string>;
  started: boolean;
  lastCleanupAt: number;
};

const globalForWorker = globalThis as typeof globalThis & {
  __harnessQueue?: QueueState;
};

function state(): QueueState {
  if (!globalForWorker.__harnessQueue) {
    globalForWorker.__harnessQueue = {
      queue: [],
      running: new Set<string>(),
      started: false,
      lastCleanupAt: 0
    };
  }
  return globalForWorker.__harnessQueue;
}

export function enqueueTask(taskId: string): void {
  const queueState = state();
  if (!queueState.queue.includes(taskId) && !queueState.running.has(taskId)) {
    queueState.queue.push(taskId);
  }
  startWorker();
}

export function removeQueuedTask(taskId: string): void {
  const queueState = state();
  queueState.queue = queueState.queue.filter((queuedTaskId) => queuedTaskId !== taskId);
}

export function startWorker(): void {
  const queueState = state();
  void runMaintenanceCleanup(queueState);
  if (queueState.started) {
    return;
  }
  queueState.started = true;
  void tick();
}

async function runMaintenanceCleanup(queueState: QueueState): Promise<void> {
  const now = Date.now();
  if (now - queueState.lastCleanupAt < 60 * 60 * 1000) {
    return;
  }
  queueState.lastCleanupAt = now;
  try {
    await cleanupWorktrees({
      mode: "expired-blocked",
      tasks: listTasks(),
      projectPaths: listProjects().map((project) => project.path),
      excludeTaskIds: [...queueState.queue, ...queueState.running]
    });
  } catch {
    // Maintenance cleanup must never prevent task execution.
  }
}

async function tick(): Promise<void> {
  const queueState = state();
  const maxParallel = Number.parseInt(process.env.MAX_PARALLEL_TASKS || "3", 10);
  while (queueState.queue.length > 0 && queueState.running.size < maxParallel) {
    const taskId = queueState.queue.shift();
    if (!taskId) {
      continue;
    }
    queueState.running.add(taskId);
    void processTask(taskId).finally(() => {
      queueState.running.delete(taskId);
      setTimeout(() => void tick(), 10);
    });
  }

  if (queueState.queue.length === 0 && queueState.running.size === 0) {
    queueState.started = false;
  } else {
    setTimeout(() => void tick(), 250);
  }
}

export function workerSnapshot(): { queued: string[]; running: string[] } {
  const queueState = state();
  return {
    queued: [...queueState.queue],
    running: [...queueState.running]
  };
}
