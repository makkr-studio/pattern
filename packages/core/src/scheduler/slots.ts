/**
 * Pattern — scheduler primitives (§11).
 *
 * The scheduler needs no topological sort: value-edge ordering is enforced by
 * promise deferreds, control ordering by dataless pulses, and stream fan-out by
 * a backpressured hub. This file holds those three primitives plus the "skip"
 * propagation used when a branch/switch/gate leaves part of the graph unreached.
 */

/** A promise with externally accessible `resolve`/`reject`, settled-once. */
export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason?: unknown) => void;
  settled = false;
  /** The resolved value (for synchronous, non-blocking inspection — e.g. I/O sampling). */
  value?: T;
  /** True once resolved (not rejected). */
  resolved = false;

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = (v) => {
        if (this.settled) return;
        this.settled = true;
        this.resolved = true;
        this.value = v;
        res(v);
      };
      this.reject = (e) => {
        if (this.settled) return;
        this.settled = true;
        rej(e);
      };
    });
    // Prevent unhandledRejection if a rejected slot is never awaited (e.g. a
    // skipped branch). Real awaiters still observe the rejection.
    this.promise.catch(() => {});
  }
}

/**
 * Thrown into a value slot / stream when its producer was *skipped* (a control
 * branch not taken). Distinct from a real error: the scheduler treats a node
 * that fails because of `SkipSignal` as skipped, propagating the skip forward
 * rather than failing the run.
 */
export class SkipSignal {
  readonly __skip = true;
  constructor(readonly nodeId: string) {}
}

export function isSkip(err: unknown): err is SkipSignal {
  return err instanceof SkipSignal || (typeof err === "object" && err != null && "__skip" in err);
}

/** The outcome of a control pulse: a real pulse, or a skip (path not taken). */
export type PulseResult = "pulse" | "skip";

/** A backpressured, multi-consumer broadcast of a stream (the "tee/fan-out"). */
export class StreamHub<T = unknown> {
  private readonly subs: SubChannel<T>[] = [];
  private source?: ReadableStream<T>;
  private settled = false;
  private readonly _done = new Deferred<void>();

  /**
   * Optional per-chunk observer — set before `connect`. Sees every chunk exactly
   * once at the pump (used for I/O sampling: bounded `stream.chunk` span events).
   * Passive: it never affects flow and its throws are swallowed.
   */
  onChunk?: (value: T) => void;

  /** Resolves when the source is fully drained (or the hub is closed/errored). */
  get done(): Promise<void> {
    return this._done.promise;
  }

  /** Register a consumer; returns an independent, backpressured stream. */
  subscribe(): ReadableStream<T> {
    const sub = new SubChannel<T>();
    this.subs.push(sub);
    return sub.readable;
  }

  /** Attach the producer's stream and begin pumping to all subscribers. */
  connect(source: ReadableStream<T>): void {
    if (this.settled) return;
    this.settled = true;
    this.source = source;
    void this.pump();
  }

  /** No stream was produced for this port: close all subscribers empty. */
  close(): void {
    if (this.settled) return;
    this.settled = true;
    for (const s of this.subs) s.close();
    this._done.resolve();
  }

  /** Producer was skipped/errored: propagate to consumers. */
  fail(err: unknown): void {
    if (this.settled) {
      // Already pumping; surface the error to subscribers.
      for (const s of this.subs) s.error(err);
      return;
    }
    this.settled = true;
    for (const s of this.subs) s.error(err);
    this._done.resolve();
  }

  private async pump(): Promise<void> {
    const reader = this.source!.getReader();
    try {
      for (;;) {
        // Backpressure: wait until *every* live subscriber can take more, so a
        // slow branch slows the source instead of unbounded-buffering (§11).
        const live = this.subs.filter((s) => !s.cancelled && !s.closed);
        if (live.length) await Promise.all(live.map((s) => s.ready()));
        const { done, value } = await reader.read();
        if (done) break;
        if (this.onChunk) {
          try {
            this.onChunk(value);
          } catch {
            /* sampling is best-effort — never let it disturb the stream */
          }
        }
        for (const s of this.subs) s.push(value);
      }
      for (const s of this.subs) s.close();
      this._done.resolve();
    } catch (err) {
      for (const s of this.subs) s.error(err);
      this._done.resolve();
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * One subscriber's view of a hub: a `ReadableStream` with a `ready()` gate the
 * hub awaits before producing the next chunk (high-water mark of 1 → bounded
 * buffering per consumer).
 */
class SubChannel<T> {
  readonly readable: ReadableStream<T>;
  private controller!: ReadableStreamDefaultController<T>;
  private wantMore?: () => void;
  cancelled = false;
  closed = false;

  constructor() {
    this.readable = new ReadableStream<T>(
      {
        start: (c) => {
          this.controller = c;
        },
        pull: () => {
          const w = this.wantMore;
          this.wantMore = undefined;
          w?.();
        },
        cancel: () => {
          this.cancelled = true;
          const w = this.wantMore;
          this.wantMore = undefined;
          w?.();
        },
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    );
  }

  ready(): Promise<void> {
    if (this.cancelled || this.closed) return Promise.resolve();
    const ds = this.controller.desiredSize;
    if (ds === null || ds > 0) return Promise.resolve();
    return new Promise<void>((res) => {
      this.wantMore = res;
    });
  }

  push(v: T): void {
    if (this.cancelled || this.closed) return;
    try {
      this.controller.enqueue(v);
    } catch {
      /* downstream gone */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      /* already closed */
    }
  }

  error(e: unknown): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.error(e);
    } catch {
      /* already closed */
    }
  }
}
