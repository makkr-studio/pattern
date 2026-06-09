import { describe, it, expect, afterEach } from "vitest";
import { Engine, defineOp, stream, value, z, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";
import { iterableToStream } from "@pattern/core";

/** An op that emits a fixed token stream — stands in for `ai.agent`. */
const tokensOp = defineOp({
  type: "test.tokens",
  inputs: { prompt: value(z.string()) },
  outputs: { tokens: stream(z.string()) },
  execute: async (ctx) => {
    const prompt = (await ctx.input.value<string>("prompt")) ?? "hi";
    return { tokens: iterableToStream(prompt.split(" ").map((w, i) => (i === 0 ? w : " " + w))) };
  },
});

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

describe("HTTP host", () => {
  it("serves a buffered JSON response", async () => {
    const engine = new Engine();
    engine.registerOp(tokensOp);
    const wf: Workflow = {
      id: "echo",
      nodes: [
        { id: "in", op: "boundary.http.request" },
        { id: "build", op: "core.object.build", config: { keys: ["youSent"] } },
        { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
      ],
      edges: [
        { from: { node: "in", port: "body" }, to: { node: "build", port: "youSent" } },
        { from: { node: "build", port: "out" }, to: { node: "out", port: "body" } },
      ],
    };
    engine.registerWorkflow(wf);
    const host = createHttpHost(engine, { routes: [{ method: "POST", path: "/echo", workflow: "echo" }] });
    const { port, close } = await host.listen(0);
    closer = close;

    const res = await fetch(`http://localhost:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ youSent: { hello: "world" } });
  });

  it("streams an SSE response (agent → split → SSE + TTS, §6 shape)", async () => {
    const engine = new Engine();
    engine.registerOp(tokensOp);
    const wf: Workflow = {
      id: "chat",
      nodes: [
        { id: "in", op: "boundary.http.request" },
        { id: "agent", op: "test.tokens" },
        { id: "split", op: "core.stream.split", config: { branches: 2 } },
        { id: "tts", op: "core.stream.accumulate", config: { mode: "concat" } },
        { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
      ],
      edges: [
        // Drive the pipeline from the trigger via a control pulse (prompt defaults to "hi").
        { from: { node: "in", port: "out" }, to: { node: "agent", port: "in" } },
        { from: { node: "agent", port: "tokens" }, to: { node: "split", port: "in" } },
        { from: { node: "split", port: "out.0" }, to: { node: "out", port: "stream" } },
        { from: { node: "split", port: "out.1" }, to: { node: "tts", port: "in" } },
      ],
    };
    engine.registerWorkflow(wf);
    const host = createHttpHost(engine, { routes: [{ path: "/chat", workflow: "chat" }] });
    const { port, close } = await host.listen(0);
    closer = close;

    const res = await fetch(`http://localhost:${port}/chat`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    // Default prompt "hi" → one token "hi".
    expect(text).toContain("data: hi");
  });
});
