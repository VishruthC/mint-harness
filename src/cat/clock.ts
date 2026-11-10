/**
 * Single animation-clock owner for the cat companion.
 *
 * The clock is intentionally tiny: one interval, start/stop idempotent, and an
 * injected timer API so tests can verify scheduling and cleanup without real
 * sleeps. It is paused by the TUI on terminal blur and disabled entirely when
 * the companion is off, so no animation loop runs in the background.
 */
export interface ClockTimers {
  setInterval: (handler: () => void, timeoutMs: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
}

const defaultTimers: ClockTimers = {
  setInterval: (handler, timeoutMs) => setInterval(handler, timeoutMs),
  clearInterval: (handle) => clearInterval(handle),
};

export class CatClock {
  private handle: ReturnType<typeof setInterval> | null = null;
  private enabled = true;

  constructor(
    private readonly tick: () => void,
    private readonly intervalMs = 100,
    private readonly timers: ClockTimers = defaultTimers,
  ) {}

  get running(): boolean {
    return this.handle !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  start(): void {
    if (!this.enabled || this.handle !== null) return;
    this.handle = this.timers.setInterval(this.tick, this.intervalMs);
  }

  stop(): void {
    if (this.handle === null) return;
    this.timers.clearInterval(this.handle);
    this.handle = null;
  }

  dispose(): void {
    this.stop();
    this.enabled = false;
  }
}
