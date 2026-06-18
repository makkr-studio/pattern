import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { Engine, defineOp, stream, z, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";

/**
 * When an SSE client disconnects mid-stream, the host cancels the run so the
 * producer stops writing to a dead socket (instead of streaming all the way to
 * the end on its own). The producer observes `ctx.signal` and halts early.
 */
let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

describe("client disconnect cancels the run", () => {
  it("aborts the streaming producer when the SSE client goes away", async () => {
    const seen = { emitted: 0, aborted: false };
    const slowOp = defineOp({
      type: "test.slowtokens",
      inputs: {},
      outputs: { tokens: stream(z.string()) },
      execute: (ctx) => ({
        tokens: new ReadableStream<string>({
          async start(controller) {
            for (let i = 0; i < 50; i++) {
              if (ctx.signal.aborted) {
                seen.aborted = true;
                break;
              }
              controller.enqueue(`t${i}`);
              seen.emitted++;
              await new Promise((r) => setTimeout(r, 20));
            }
            try {
              controller.close();
            } catch {
              /* already errored on abort */
            }
          },
        }),
      }),
    });

    const engine = new Engine();
    engine.use({ name: "slow", ops: [slowOp] });
    const wf: Workflow = {
      id: "sse-route",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/sse" } },
        { id: "gen", op: "test.slowtokens" },
        { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "gen", port: "in" } },
        { from: { node: "gen", port: "tokens" }, to: { node: "out", port: "stream" } },
      ],
    };
    engine.registerWorkflow(wf);
    const ended: Array<{ status: string; endedBy?: string }> = [];
    engine.onTrace({ onRunEnd: (r) => ended.push({ status: r.status, endedBy: r.endedBy }) });
    const { close } = await createHttpHost(engine, { defaultPort: 4977 }).start();
    closer = close;

    // Read a chunk, then hard-disconnect mid-stream (destroy the socket).
    await new Promise<void>((resolve) => {
      const req = http.get("http://localhost:4977/sse", (res) => {
        res.once("data", () => {
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 40);
        });
      });
      req.on("error", () => resolve());
    });

    // Give the server a moment to notice the close and propagate the abort.
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.aborted).toBe(true); // the producer saw ctx.signal abort
    expect(seen.emitted).toBeLessThan(50); // it stopped well before the full stream
    expect(ended).toHaveLength(1); // the run finalized (didn't hang)
  });
});
