import { describe, it, expect } from "vitest";
import { Engine, type RunHandle, type RunRequest, type RunTransport, type Workflow } from "@pattern/core";

/**
 * Per-run transport routing: a workflow flagged `offload` dispatches to the
 * engine's `offloadTransport` (the worker pool); everything else stays on the
 * inline transport. With no pool configured the flag is a graceful no-op.
 */

/** A transport that records what it was asked to dispatch and returns ok. */
function recordingTransport(kind: string): { transport: RunTransport; seen: RunRequest[] } {
  const seen: RunRequest[] = [];
  const transport: RunTransport = {
    dispatch(req: RunRequest): RunHandle {
      seen.push(req);
      const runId = req.runId ?? `${kind}-${seen.length}`;
      return { runId, result: Promise.resolve({ runId, status: "ok", outputs: {} }), abort() {} };
    },
    describe: () => ({ kind }),
  };
  return { transport, seen };
}

const passthrough = (id: string, offload?: boolean): Workflow => ({
  id,
  ...(offload !== undefined ? { offload } : {}),
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [{ from: { node: "in", port: "v" }, to: { node: "out", port: "value" } }],
});

describe("offload run routing", () => {
  it("routes an offload:true workflow to the offload transport, others to inline", async () => {
    const inline = recordingTransport("inline");
    const pool = recordingTransport("worker-pool");
    const engine = new Engine({ transport: inline.transport, offloadTransport: pool.transport });

    await engine.run(passthrough("normal"));
    await engine.run(passthrough("heavy", true));

    expect(inline.seen.map((r) => r.workflow.id)).toEqual(["normal"]);
    expect(pool.seen.map((r) => r.workflow.id)).toEqual(["heavy"]);
  });

  it("falls back to inline when offload is flagged but no pool is configured", async () => {
    const inline = recordingTransport("inline");
    const engine = new Engine({ transport: inline.transport });

    await engine.run(passthrough("heavy", true));

    expect(inline.seen.map((r) => r.workflow.id)).toEqual(["heavy"]);
  });

  it("transportInfo carries the offload pool's description alongside inline", () => {
    const inline = recordingTransport("inline");
    const pool = recordingTransport("worker-pool");
    const withPool = new Engine({ transport: inline.transport, offloadTransport: pool.transport });
    expect(withPool.transportInfo()).toEqual({ kind: "inline", offload: { kind: "worker-pool" } });

    const noPool = new Engine({ transport: inline.transport });
    expect(noPool.transportInfo()).toEqual({ kind: "inline" });
  });

  it("closes the offload transport on engine.close()", async () => {
    let closed = false;
    const inline = recordingTransport("inline");
    const pool: RunTransport = { ...recordingTransport("worker-pool").transport, close: async () => void (closed = true) };
    const engine = new Engine({ transport: inline.transport, offloadTransport: pool });
    await engine.close();
    expect(closed).toBe(true);
  });
});
