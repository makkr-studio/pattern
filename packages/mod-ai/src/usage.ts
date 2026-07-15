/**
 * @pattern-js/mod-ai — the usage tap (0.5 metering).
 *
 * Every language-model call in the framework obtains its model from
 * `ProviderService.languageModel()` — plain ops, the agent loop, chat, history
 * compaction all funnel through that one seam. Wrapping the returned model
 * with this middleware therefore meters EVERYTHING with a single tap: each
 * call lands its token counts on the node's span (`ai.*` attributes) and emits
 * an `ai.usage` event on the bus, attributed to the calling principal.
 *
 * Metering is telemetry, never a gate: every capture path is fail-open — an
 * error recording usage must not break (or even delay) the generation itself.
 * Anything can subscribe to `ai.usage`; mod-billing's optional metering
 * workflow turns it into provider meter events (billing by the token as an
 * edge, not code).
 */

import type { OpContext } from "@pattern-js/core";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "./sdk.js";

/** The `ai.usage` bus event, one per model call. */
export interface AiUsageEvent {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** The calling principal's user id; ABSENT for anonymous/system calls (so
   *  a plain has-check filters unattributed usage on canvas). */
  userId?: string;
  runId: string;
  workflowId: string;
  nodeId: string;
}

/** Provider-level (V3) usage: token counts nest under `.total`. */
interface V3Usage {
  inputTokens?: { total?: number };
  outputTokens?: { total?: number };
}

/** Flatten the provider-level usage shape into plain token counts. */
function flatten(u: V3Usage | undefined): { inputTokens?: number; outputTokens?: number; totalTokens?: number } {
  const inputTokens = u?.inputTokens?.total;
  const outputTokens = u?.outputTokens?.total;
  const totalTokens =
    inputTokens === undefined && outputTokens === undefined ? undefined : (inputTokens ?? 0) + (outputTokens ?? 0);
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Wrap a language model so every generate/stream call reports its usage.
 * Models below middleware spec v3 pass through untapped (their usage still
 * flows on op outputs; only the bus/span tap is skipped).
 */
export function withUsageTap(model: LanguageModel, ctx: OpContext): LanguageModel {
  if (typeof model === "string") return model; // a bare gateway model id — nothing to wrap
  if ((model as { specificationVersion?: string }).specificationVersion !== "v3") return model;

  const record = (usage: V3Usage | undefined): void => {
    // Fail-open by contract: usage capture must never break generation.
    try {
      const flat = flatten(usage);
      if (flat.totalTokens === undefined) return; // provider reported nothing — no event, no noise
      const modelId = (model as { modelId?: string }).modelId ?? "unknown";
      ctx.trace.setAttributes({
        "ai.modelId": modelId,
        "ai.inputTokens": flat.inputTokens,
        "ai.outputTokens": flat.outputTokens,
        "ai.totalTokens": flat.totalTokens,
      });
      ctx.services.events.emit("ai.usage", {
        modelId,
        ...flat,
        ...(ctx.principal.kind === "user" ? { userId: ctx.principal.id } : {}),
        runId: ctx.runId,
        workflowId: ctx.workflowId,
        nodeId: ctx.nodeId,
      } satisfies AiUsageEvent);
    } catch {
      /* metering is telemetry — swallow and let the generation proceed */
    }
  };

  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      record(result.usage as V3Usage);
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      // Usage arrives on the terminal `finish` part — tap it in transit.
      const stream = result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            const p = part as { type?: string; usage?: V3Usage };
            if (p?.type === "finish") record(p.usage);
            controller.enqueue(part);
          },
        }),
      );
      return { ...result, stream };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return wrapLanguageModel({ model: model as any, middleware }) as LanguageModel;
}
