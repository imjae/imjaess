const DEFAULT_SHUTDOWN_DELAY_MS = 250;

type Timer = (callback: () => void, delayMs: number) => unknown;
type ExitProcess = (code: number) => void;

let shutdownScheduled = false;

export function scheduleServerShutdown(options: { delayMs?: number; setTimer?: Timer; exitProcess?: ExitProcess } = {}): {
  delayMs: number;
  scheduled: boolean;
} {
  const delayMs = options.delayMs ?? DEFAULT_SHUTDOWN_DELAY_MS;

  if (shutdownScheduled) {
    return { delayMs, scheduled: false };
  }

  shutdownScheduled = true;
  const setTimer = options.setTimer ?? setTimeout;
  const exitProcess = options.exitProcess ?? ((code: number) => process.exit(code));

  setTimer(() => {
    exitProcess(0);
  }, delayMs);

  return { delayMs, scheduled: true };
}

export function resetServerShutdownForTests(): void {
  shutdownScheduled = false;
}
