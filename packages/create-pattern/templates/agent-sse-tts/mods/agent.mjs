/**
 * An app-local mod with two ops:
 *
 *  - `agent.tokens` — a mock LLM agent: streams the reply word by word. Swap its
 *    execute for a real model call (e.g. Anthropic's streaming API with the key
 *    from `$env:ANTHROPIC_API_KEY`) — the workflow JSON doesn't change.
 *  - `agent.tts` — a mock text-to-speech sink: receives the *accumulated* reply
 *    (the second branch of the stream split) and pretends to synthesize it.
 *    Swap for a real TTS provider the same way.
 *
 * Together with `workflows/chat.json` this is the canonical streaming shape:
 * one producer, `core.stream.split`, and two consumers at different speeds —
 * SSE tokens to the browser while TTS waits for the full text (BARRIER).
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {import("@pattern/core").PatternMod} */
export default {
  name: "agent-mod",
  ops: [
    {
      type: "agent.tokens",
      title: "agent.tokens",
      description: "Mock agent: streams a reply token by token. Replace with a real LLM call.",
      inputs: { prompt: { kind: "value" } },
      outputs: { out: { kind: "stream" } },
      execute: async (ctx) => {
        const raw = await ctx.input.value("prompt");
        // Accept a plain string or the whole query object ({ prompt: "..." }).
        const prompt = String((raw && typeof raw === "object" ? raw.prompt : raw) ?? "world");
        const reply = `You said “${prompt}”. Here is a streamed reply, one token at a time, ready to be swapped for a real model.`;
        const tokens = reply.split(" ");
        return {
          out: new ReadableStream({
            async start(controller) {
              for (const t of tokens) {
                controller.enqueue(`${t} `);
                await wait(40); // simulate model latency per token
              }
              controller.close();
            },
          }),
        };
      },
    },
    {
      type: "agent.tts",
      title: "agent.tts",
      description: "Mock TTS: receives the full accumulated reply. Replace with a real synthesis call.",
      inputs: { text: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => {
        const text = String((await ctx.input.value("text")) ?? "");
        ctx.log("info", `tts: would synthesize ${text.length} chars`);
        return { out: { synthesized: true, chars: text.length } };
      },
    },
  ],
};
