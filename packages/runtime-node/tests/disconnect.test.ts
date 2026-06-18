import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { Engine, defineOp, stream, z, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";

/**
 * A run is independent of the client connection by DEFAULT — a chat turn or a
 * long task keeps running (and persisting) if the client drops, replayable on
 * reconnect. A route can opt into `cancelOnDisconnect` for a pure passthrough
 * stream where there's nothing worth finishing once the client is gone.
 */
let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

/** A long token stream that records how far it got + whether it saw an abort. */
function streamApp(cancelOnDisconnect: boolean, port: number) {
  const seen = { emitted: 0, aborted: false };
  const op = defineOp({
    type: "test.slowtokens",
    inputs: {},
    outputs: { tokens: stream(z.string()) },
    execute: (ctx) => ({
      tokens: new ReadableStream<string>({
        async start(controller) {
          for (let i = 0; i < 30; i++) {
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
            /* aborted */
          }
        },
      }),
    }),
  });
  const engine = new Engine();
  engine.use({ name: "slow", ops: [op] });
  const wf: Workflow = {
    id: "sse-route",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/sse", ...(cancelOnDisconnect ? { cancelOnDisconnect: true } : {}) } },
      { id: "gen", op: "test.slowtokens" },
      { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "gen", port: "in" } },
      { from: { node: "gen", port: "tokens" }, to: { node: "out", port: "stream" } },
    ],
  };
  engine.registerWorkflow(wf);
  return { engine, seen, port };
}

/** Open the SSE route, read a chunk, then hard-disconnect (destroy the socket). */
async function readThenDisconnect(port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = http.get(`http://localhost:${port}/sse`, (res) => {
      res.once("data", () => setTimeout(() => (req.destroy(), resolve()), 40));
    });
    req.on("error", () => resolve());
  });
}

describe("client disconnect", () => {
  it("with cancelOnDisconnect: aborts the run's producer when the client goes away", async () => {
    const { engine, seen, port } = streamApp(true, 4977);
    const { close } = await createHttpHost(engine, { defaultPort: port }).start();
    closer = close;
    await readThenDisconnect(port);
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.aborted).toBe(true);
    expect(seen.emitted).toBeLessThan(30);
  });

  it("by default: the run SURVIVES a disconnect (keeps producing — the chat case)", async () => {
    const { engine, seen, port } = streamApp(false, 4978);
    const { close } = await createHttpHost(engine, { defaultPort: port }).start();
    closer = close;
    await readThenDisconnect(port);
    const atDisconnect = seen.emitted;
    await new Promise((r) => setTimeout(r, 250));
    expect(seen.aborted).toBe(false); // never saw an abort
    expect(seen.emitted).toBeGreaterThan(atDisconnect); // kept producing past the drop
  });
});
