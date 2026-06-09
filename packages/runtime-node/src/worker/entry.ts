/**
 * @pattern/runtime-node — worker-thread run entry (§4, §8).
 *
 * Runs one workflow per `run` message on its own thread, fully isolated from the
 * host event loop. Value out-gate results are structured-cloned back; stream
 * out-gate results are forwarded chunk-by-chunk over the port and reconstructed
 * on the host. Cancellation crosses the seam via an `abort` message.
 *
 * The worker registers the base op catalog, then loads any mods named in
 * `workerData.mods` (module specifiers) before processing runs — so workflows
 * using mod-contributed ops work on the pool. Remaining v1 limitation: events/
 * hooks fire in the worker's own engine — they do not cross back to the host
 * until a network backplane exists.
 */

import { parentPort, workerData } from "node:worker_threads";
import { Engine, type RunResult } from "@pattern/core";
import { loadMods } from "../mods.js";

const port = parentPort!;
const engine = new Engine();
const aborts = new Map<string, AbortController>();

/** Mods install before the first run executes (messages queue behind this). */
const ready: Promise<void> = (async () => {
  const mods = (workerData as { mods?: string[] } | undefined)?.mods ?? [];
  if (mods.length) await loadMods(engine, mods);
})().catch((err) => {
  // Surface mod-load failures on the first run instead of dying silently.
  throw new Error(`worker failed to load mods: ${err instanceof Error ? err.message : String(err)}`);
});
// Mark handled so an idle worker doesn't crash on the rejection before the
// first run awaits `ready` (awaits still observe the rejected state).
void ready.catch(() => {});

interface RunMessage {
  type: "run";
  id: string;
  workflow: any;
  triggerNodeId: string;
  input: Record<string, unknown>;
  principal: any;
  params?: Record<string, unknown>;
  sampleIo?: boolean;
  hookDepth?: number;
}

port.on("message", (msg: RunMessage | { type: "abort"; id: string }) => {
  if (msg.type === "run") void handleRun(msg);
  else if (msg.type === "abort") aborts.get(msg.id)?.abort();
});

async function handleRun(msg: RunMessage): Promise<void> {
  const { id, workflow, triggerNodeId, input, principal, params, sampleIo, hookDepth } = msg;
  const ac = new AbortController();
  aborts.set(id, ac);

  let result: RunResult;
  try {
    await ready;
    // Upsert so a re-dispatched workflow always runs its latest definition.
    // (Throws only for boundary config ports, which need the async resolve
    // phase — the run below still executes the passed definition directly.)
    try {
      engine.registerWorkflow(workflow, { validate: false });
    } catch {
      /* boundary config ports — resolved on the host, run directly here */
    }
    result = await engine.runFrom(workflow, triggerNodeId, input, principal, ac.signal, params, sampleIo, hookDepth);
  } catch (err) {
    port.postMessage({ type: "result", id, status: "error", outputs: {}, error: serializeError(err) });
    port.postMessage({ type: "done", id });
    aborts.delete(id);
    return;
  }

  // Replace stream values with placeholders and forward them after the result.
  let counter = 0;
  const streamTasks: Promise<void>[] = [];
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const [nodeId, payload] of Object.entries(result.outputs)) {
    const sp: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v instanceof ReadableStream) {
        const streamId = `${id}:${counter++}`;
        sp[k] = { __patternStream: streamId };
        streamTasks.push(forwardStream(id, streamId, v as ReadableStream<unknown>));
      } else {
        sp[k] = v;
      }
    }
    outputs[nodeId] = sp;
  }

  port.postMessage({
    type: "result",
    id,
    status: result.status,
    outputs,
    error: result.error ? serializeError(result.error) : undefined,
  });
  await Promise.all(streamTasks);
  port.postMessage({ type: "done", id });
  aborts.delete(id);
}

async function forwardStream(runId: string, streamId: string, stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      port.postMessage({ type: "chunk", runId, streamId, value });
    }
    port.postMessage({ type: "streamEnd", runId, streamId });
  } catch (err) {
    port.postMessage({ type: "streamError", runId, streamId, error: serializeError(err) });
  } finally {
    reader.releaseLock();
  }
}

function serializeError(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) return { message: err.message, name: err.name };
  return { message: String(err) };
}
