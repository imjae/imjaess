import { afterEach, describe, expect, it } from "vitest";
import { resetServerShutdownForTests, scheduleServerShutdown } from "@/lib/server-shutdown";

describe("server shutdown", () => {
  afterEach(() => {
    resetServerShutdownForTests();
  });

  it("schedules one delayed process exit", () => {
    const timers: Array<{ callback: () => void; delayMs: number }> = [];
    const exitCodes: number[] = [];

    const result = scheduleServerShutdown({
      delayMs: 50,
      setTimer: (callback, delayMs) => timers.push({ callback, delayMs }),
      exitProcess: (code) => {
        exitCodes.push(code);
      }
    });

    expect(result).toEqual({ delayMs: 50, scheduled: true });
    expect(timers).toHaveLength(1);
    expect(timers[0].delayMs).toBe(50);

    timers[0].callback();

    expect(exitCodes).toEqual([0]);
  });

  it("does not schedule duplicate exits", () => {
    const timers: Array<{ callback: () => void; delayMs: number }> = [];

    scheduleServerShutdown({
      setTimer: (callback, delayMs) => timers.push({ callback, delayMs }),
      exitProcess: () => undefined
    });
    const duplicate = scheduleServerShutdown({
      setTimer: (callback, delayMs) => timers.push({ callback, delayMs }),
      exitProcess: () => undefined
    });

    expect(duplicate).toEqual({ delayMs: 250, scheduled: false });
    expect(timers).toHaveLength(1);
  });
});
