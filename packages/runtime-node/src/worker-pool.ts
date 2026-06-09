/**
 * @pattern/runtime-node — worker-thread pool transport (§4, §8).
 *
 * A `RunTransport` that dispatches each run to a `node:worker_threads` worker,
 * so a run executes off the host event loop (the workflow is the unit of
 * isolation, §1). Streamed out-gate results are reconstructed on the host;
 * cancellation crosses the seam. It is a drop-in for `InProcessTransport` — the
 * scheduler never knows the difference — and the same interface later allows a
 * queue + remote workers (distribution).
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

  constructor() {
    this.worker = new Worker(WORKER_URL);
    this.worker.on("message", (msg: any) => this.onMessage(msg));
    this.worker.on("error", (err) => {
      for (const p of this.pending.values()) if (!p.settled) p.reject(err);
      this.pending.clear();
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
}

export class WorkerPoolTransport implements RunTransport {
  private workers: WorkerWrapper[];
  private rr = 0;

  constructor(opts: WorkerPoolOptions = {}) {
    const size = Math.max(1, opts.size ?? availableParallelism() - 1);
    this.workers = Array.from({ length: size }, () => new WorkerWrapper());
  }

  dispatch(req: RunRequest): RunHandle {
    // Least-inflight selection, falling back to round-robin.
    const worker =
      this.workers.reduce((a, b) => (b.inflight < a.inflight ? b : a), this.workers[this.rr++ % this.workers.length]!) ??
      this.workers[0]!;
    const runId = crypto.randomUUID();
    const result = worker.run(req, runId);
    return {
      runId,
      result,
      abort: () => worker.abort(runId),
    };
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
