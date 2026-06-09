/**
 * Pattern — in-process run transport (§4).
 *
 * The simplest `RunTransport`: it runs the workflow on the host event loop. It
 * exists so the scheduler never knows *where* a run executes — `runtime-node`
 * ships a `node:worker_threads` pool transport with the exact same interface, and
 * a queue + remote workers can be added later without touching the scheduler.
 */

import { runWorkflow, type RunDeps } from "../scheduler/run.js";
import type { RunHandle, RunRequest, RunTransport } from "../types.js";

export class InProcessTransport implements RunTransport {
  constructor(private readonly deps: RunDeps) {}

  dispatch(req: RunRequest): RunHandle {
    const ac = new AbortController();
    const runId = crypto.randomUUID();
    const result = runWorkflow(
      this.deps,
      {
        workflow: req.workflow,
        triggerNodeId: req.triggerNodeId,
        input: req.input,
        principal: req.principal,
        params: req.params,
        sampleIo: req.sampleIo,
        runId,
      },
      ac.signal,
    );
    return {
      runId,
      result,
      abort: (reason?: unknown) => ac.abort(reason),
    };
  }
}
