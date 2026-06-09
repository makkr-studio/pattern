/**
 * agent-sse-tts — the streaming showcase (spec §6).
 *
 *   request → agent(tokens: stream) → split(2) ─┬─▶ SSE response body
 *                                                └─▶ TTS synthesis
 *
 * `agent.tokens` is a `stream<string>`, split into two stream branches that run
 * concurrently with backpressure: one feeds the SSE response, the other a (mock)
 * TTS op. This is the dataflow style — data flows incrementally, not as one blob.
 *
 * Swap `app.agent` for a real LLM call (return a `ReadableStream<string>` of
 * tokens) and `app.tts` for a real synthesizer; the graph stays the same.
 */
import { Engine, defineOp, stream, value, z, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";

/** Mock streaming agent: emits a few tokens with small delays. */
const agent = defineOp({
  type: "app.agent",
  title: "app.agent",
  inputs: { prompt: value(z.string()) },
  outputs: { tokens: stream(z.string()) },
  execute: async (ctx) => {
    const prompt = (await ctx.input.value<string>("prompt")) ?? "Tell me about Pattern.";
    const words = `You asked: "${prompt}". Pattern runs workflows as typed dataflow graphs.`.split(" ");
    const tokens = new ReadableStream<string>({
      async start(controller) {
        for (const w of words) {
          if (ctx.signal.aborted) break;
          controller.enqueue(w + " ");
          await new Promise((r) => setTimeout(r, 40));
        }
        controller.close();
      },
    });
    return { tokens };
  },
});

/** Mock TTS: consumes the token stream and "synthesizes" each chunk. */
const tts = defineOp({
  type: "app.tts",
  title: "app.tts",
  inputs: { text: stream(z.string()) },
  outputs: {},
  execute: async (ctx) => {
    const reader = ctx.input.stream<string>("text").getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      process.stdout.write(`🔊 ${chunk}`);
    }
    process.stdout.write("\n");
    return {};
  },
});

const chat: Workflow = {
  id: "chat",
  name: "Chat with streamed TTS",
  nodes: [
    { id: "in", op: "boundary.http.request" },
    { id: "q", op: "core.object.get", config: { path: "q" } },
    { id: "agent", op: "app.agent" },
    { id: "split", op: "core.stream.split", config: { branches: 2 } },
    { id: "tts", op: "app.tts" },
    { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
  ],
  edges: [
    { from: { node: "in", port: "query" }, to: { node: "q", port: "object" } },
    { from: { node: "q", port: "out" }, to: { node: "agent", port: "prompt" } },
    { from: { node: "agent", port: "tokens" }, to: { node: "split", port: "in" } },
    { from: { node: "split", port: "out.0" }, to: { node: "out", port: "stream" } },
    { from: { node: "split", port: "out.1" }, to: { node: "tts", port: "text" } },
  ],
};

const engine = new Engine();
engine.registerOp(agent);
engine.registerOp(tts);
engine.registerWorkflow(chat);

const host = createHttpHost(engine, { routes: [{ method: "GET", path: "/chat", workflow: "chat" }] });
const { port } = await host.listen(Number(process.env.PORT ?? 3000));
console.log(`▶ http://localhost:${port}/chat?q=hello  (Server-Sent Events)`);
