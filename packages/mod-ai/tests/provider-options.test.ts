import { describe, expect, it } from "vitest";
import { Engine, defineMod, type Workflow } from "@pattern-js/core";
import { MockLanguageModelV4 } from "ai/test";
import { aiOps } from "../src/ops/index.js";
import { callOptions } from "../src/ops/shared.js";
import { AI_PROVIDER_SERVICE } from "../src/well-known.js";
import type { AiProviderService } from "../src/provider.js";

/** A ModelRef's providerOptions reach the provider on every call made with it. */

describe("ModelRef providerOptions", () => {
  it("ai.model → ai.text.generate hands them to the model call", async () => {
    let seen: unknown;
    const provider = {
      languageModel: async () =>
        new MockLanguageModelV4({
          doGenerate: async (opts: { providerOptions?: unknown }) => {
            seen = opts.providerOptions;
            return {
              content: [{ type: "text", text: "ok" }],
              finishReason: { unified: "stop", raw: "stop" },
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
              warnings: [],
            };
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
    } as unknown as AiProviderService;
    const engine = new Engine();
    await engine.useAsync(
      defineMod({ name: "t", ops: aiOps, setup: (e) => e.provideService(AI_PROVIDER_SERVICE, provider) }),
    );
    const wf: Workflow = {
      id: "po",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["prompt", "opts"] } },
        { id: "model", op: "ai.model", config: { routing: "direct", provider: "openai", modelId: "gpt-5" } },
        { id: "gen", op: "ai.text.generate", config: {} },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "opts" }, to: { node: "model", port: "providerOptions" } },
        { from: { node: "model", port: "model" }, to: { node: "gen", port: "model" } },
        { from: { node: "in", port: "prompt" }, to: { node: "gen", port: "prompt" } },
        { from: { node: "gen", port: "text" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow;
    engine.registerWorkflow(wf);
    const res = await engine.run("po", { input: { prompt: "hi", opts: { openai: { reasoningEffort: "low" } } } });
    expect(res.status).toBe("ok");
    expect(seen).toMatchObject({ openai: { reasoningEffort: "low" } });
  });

  it("per-call extras merge over the ref's options, per provider key", () => {
    expect(callOptions(undefined)).toEqual({});
    expect(
      callOptions({ providerOptions: { openai: { a: 1, b: 1 } } }, { openai: { b: 2 }, google: { c: 3 } }),
    ).toEqual({ providerOptions: { openai: { a: 1, b: 2 }, google: { c: 3 } } });
  });
});
