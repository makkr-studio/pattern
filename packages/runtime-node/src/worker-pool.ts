/**
 * @pattern/runtime-node — worker-thread pool transport (§4, §8).
 *
 * A `RunTransport` that dispatches each run to a `node:worker_threads` worker,
 * so a run executes off the host event loop (the workflow is the unit of
 * isolation, §1). Streamed out-gate results are reconstructed on the host;
 * cancellation crosses the seam. It is a drop-in for `InProcessTransport` — the
 * scheduler never knows the difference — and the same interface later allows a
 * queue + remote workers (distribution).
 *
 * Workers register the base op catalog plus any `mods` passed in options (each
 * a module specifier the worker `import()`s and `engine.use()`s), so workflows
 * using mod-contributed ops can run on the pool too. A crashed worker rejects
 * its in-flight runs and is respawned in place.
 */

import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import type { RunHandle, RunRequest, RunResult, RunTransport } from "@pattern/core";

const WORKER_URL = new URL("./worker/entry.js", import.meta.url);

interface Pending {
  resolve: (r: RunResult) => void;
  reject: (e: unknown) => void;
  /** Stream controllers for reconstructed out-gate streams, keyed by streamId. */
  controllers: Map<string, ReadableStreamDefaultController<unknown>>;
  settled: boolean;
}

class WorkerWrapper {
  readonly worker: Worker;
  readonly pending = new Map<string, Pending>();
  inflight = 0;

  constructor(mods: string[], onFatal: (w: WorkerWrapper, err: unknown) => void) {
    this.worker = new Worker(WORKER_URL, { workerData: { mods } });
    this.worker.on("message", (msg: any) => this.onMessage(msg));
    this.worker.on("error", (err) => {
      // The thread is dead: fail every in-flight run and hand the slot back to
      // the pool for a respawn. Resetting `inflight` matters — a leaked count
      // would silently remove this slot from least-inflight selection forever.
      for (const p of this.pending.values()) if (!p.settled) p.reject(err);
      this.pending.clear();
      this.inflight = 0;
      onFatal(this, err);
    });
  }

  private onMessage(msg: any): void {
    const p = this.pending.get(msg.id ?? msg.runId);
    if (!p) return;
    switch (msg.type) {
      case "result": {
        const outputs: Record<string, Record<string, unknown>> = {};
        for (const [nodeId, payload] of Object.entries(msg.outputs as Record<string, Record<string, unknown>>)) {
          const sp: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(payload)) {
            if (v && typeof v === "object" && "__patternStream" in v) {
              const streamId = (v as { __patternStream: string }).__patternStream;
              sp[k] = new ReadableStream<unknown>({
                start: (controller) => p.controllers.set(streamId, controller),
              });
            } else {
              sp[k] = v;
            }
          }
          outputs[nodeId] = sp;
        }
        p.settled = true;
        p.resolve({
          runId: msg.id,
          status: msg.status,
          outputs,
          error: msg.error ? Object.assign(new Error(msg.error.message), { name: msg.error.name }) : undefined,
        });
        break;
      }
      case "chunk":
        p.controllers.get(msg.streamId)?.enqueue(msg.value);
        break;
      case "streamEnd":
        try {
          p.controllers.get(msg.streamId)?.close();
        } catch {
          /* ignore */
        }
        p.controllers.delete(msg.streamId);
        break;
      case "streamError":
        try {
          p.controllers.get(msg.streamId)?.error(new Error(msg.error?.message ?? "stream error"));
        } catch {
          /* ignore */
        }
        p.controllers.delete(msg.streamId);
        break;
      case "done":
        this.pending.delete(msg.id);
        this.inflight = Math.max(0, this.inflight - 1);
        break;
    }
  }

  run(req: RunRequest, runId: string): Promise<RunResult> {
    this.inflight++;
    return new Promise<RunResult>((resolve, reject) => {
      this.pending.set(runId, { resolve, reject, controllers: new Map(), settled: false });
      this.worker.postMessage({
        type: "run",
        id: runId,
        workflow: req.workflow,
        triggerNodeId: req.triggerNodeId,
        input: req.input,
        principal: req.principal,
        params: req.params,
        sampleIo: req.sampleIo,
        hookDepth: req.hookDepth,
      });
    });
  }

  abort(runId: string): void {
    this.worker.postMessage({ type: "abort", id: runId });
  }

  terminate(): Promise<number> {
    return this.worker.terminate();
  }
}

export interface WorkerPoolOptions {
  /** Number of workers (default: available parallelism − 1, min 1). */
  size?: number;
  /**
   * Mod module specifiers each worker loads at startup (same resolution as
   * `loadMods`: bare npm/workspace specifiers, or absolute paths/file URLs).
   * Without this, workers have only the base op catalog and a workflow using a
   * mod-contributed op fails with "unknown op".
   */
  mods?: string[];
}

export class WorkerPoolTransport implements RunTransport {
  private workers: WorkerWrapper[];
  private rr = 0;
  private closed = false;
  private readonly mods: string[];

  constructor(opts: WorkerPoolOptions = {}) {
    const size = Math.max(1, opts.size ?? availableParallelism() - 1);
    this.mods = opts.mods ?? [];
    this.workers = Array.from({ length: size }, () => this.spawn());
  }

  private spawn(): WorkerWrapper {
    return new WorkerWrapper(this.mods, (dead) => this.respawn(dead));
  }

  /** Replace a crashed worker so the pool keeps its capacity. */
  private respawn(dead: WorkerWrapper): void {
    void dead.terminate().catch(() => {});
    if (this.closed) return;
    const i = this.workers.indexOf(dead);
    if (i >= 0) this.workers[i] = this.spawn();
  }

  describe(): Record<string, unknown> {
    return {
      kind: "worker-pool",
      size: this.workers.length,
      inflight: this.workers.map((w) => w.inflight),
      threadIds: this.workers.map((w) => w.worker.threadId),
    };
  }

  dispatch(req: RunRequest): RunHandle {
    if (this.closed || this.workers.length === 0) {
      throw new Error("WorkerPoolTransport is closed");
    }
    // Least-inflight selection; the rotating scan start breaks ties fairly.
    const n = this.workers.length;
    let worker = this.workers[this.rr % n]!;
    for (let i = 1; i < n; i++) {
      const w = this.workers[(this.rr + i) % n]!;
      if (w.inflight < worker.inflight) worker = w;
    }
    this.rr = (this.rr + 1) % n;

    const runId = crypto.randomUUID();
    const result = worker.run(req, runId);
    return {
      runId,
      result,
      abort: () => worker.abort(runId),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    const workers = this.workers;
    this.workers = [];
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
