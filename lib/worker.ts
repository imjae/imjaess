import { processTask } from "@/lib/orchestrator";
import { listProjects, listTasks, updateTask } from "@/lib/db";
import { cleanupWorktrees } from "@/lib/worktree-cleanup";

type QueueState = {
  queue: string[];
  running: Map<string, AbortController>;
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
      running: new Map<string, AbortController>(),
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

export function cancelTask(taskId: string): boolean {
  const queueState = state();
  const wasQueued = queueState.queue.includes(taskId);
  if (wasQueued) {
    queueState.queue = queueState.queue.filter((queuedTaskId) => queuedTaskId !== taskId);
    updateTask(taskId, {
      status: "canceled",
      failureReason: "Task was canceled before it started."
    });
    return true;
  }

  const controller = queueState.running.get(taskId);
  if (!controller) {
    return false;
  }
  updateTask(taskId, {
    status: "canceled",
    failureReason: "Task cancellation requested. Waiting for the active agent to stop."
  });
  controller.abort();
  return true;
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
      excludeTaskIds: [...queueState.queue, ...queueState.running.keys()]
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
    const abortController = new AbortController();
    queueState.running.set(taskId, abortController);
    void processTask(taskId, abortController.signal).finally(() => {
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
    running: [...queueState.running.keys()]
  };
}
