/* SPDX-License-Identifier: GPL-3.0-or-later */
export interface CloseSaveResult { requestId: string; ok: boolean; error?: string; stale?: boolean }
interface Attempt { requestId: string; cancelled: boolean; failures: string[] }
export interface CloseSaveActions<T> {
  stop: () => Promise<void> | void;
  afterDrain?: () => Promise<void> | void;
  snapshot: () => T | null;
  save: (snapshot: T) => Promise<boolean>;
  timeoutMs?: number;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function scheduleAutosave<T>(snapshot: T, save: (value: T) => Promise<unknown>, isClosing: () => boolean, delay = 650,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  clear: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout): () => void {
  let cancelled = false;
  const timer = schedule(() => { if (!cancelled && !isClosing()) void save(snapshot); }, delay);
  return () => { cancelled = true; clear(timer); };
}

/** Drain already-accepted document work before taking the final snapshot.
 * The renderer owns its edit gate; native code owns whether an ACK closes the window.
 */
export class CloseSaveCoordinator<T> {
  private pending = new Set<Promise<unknown>>();
  private attempt: Attempt | null = null;
  track<R>(task: Promise<R>): Promise<R> {
    this.pending.add(task);
    task.then(() => this.pending.delete(task), error => { this.pending.delete(task); this.reportFailure(error); });
    return task;
  }
  reportFailure(error: unknown): void { if (this.attempt && !this.attempt.cancelled) this.attempt.failures.push(message(error)); }
  isCurrent(requestId: string): boolean { return this.attempt?.requestId === requestId && !this.attempt.cancelled; }
  cancel(requestId: string): boolean {
    if (!this.isCurrent(requestId)) return false;
    this.attempt!.cancelled = true; this.attempt = null; return true;
  }
  async flush(requestId: string, actions: CloseSaveActions<T>): Promise<CloseSaveResult> {
    const attempt: Attempt = { requestId, cancelled: false, failures: [] };
    if (this.attempt) this.attempt.cancelled = true;
    this.attempt = attempt;
    const assertCurrent = () => { if (!this.isCurrent(requestId) || this.attempt !== attempt) throw new Error('This close request was cancelled.'); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = async () => {
        await actions.stop(); assertCurrent();
        while (this.pending.size) { await Promise.allSettled([...this.pending]); assertCurrent(); }
        if (attempt.failures.length) throw new Error(attempt.failures[0]);
        await actions.afterDrain?.(); assertCurrent();
        if (attempt.failures.length) throw new Error(attempt.failures[0]);
        const snapshot = actions.snapshot();
        if (snapshot && !await actions.save(snapshot)) throw new Error('The latest project could not be saved. Check the project folder and available disk space, then retry or keep editing.');
        assertCurrent();
      };
      await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Saving before closing took too long. The app is staying open; wait for pending media work and try again.')), actions.timeoutMs ?? 45000); })]);
      return { requestId, ok: true };
    } catch (error) { const stale = !this.isCurrent(requestId); attempt.cancelled = true; return { requestId, ok: false, error: message(error), stale }; }
    finally { if (timer) clearTimeout(timer); }
  }
}
