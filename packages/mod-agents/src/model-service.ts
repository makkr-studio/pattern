/**
 * @pattern-js/mod-agents — the neutral model-service seam.
 *
 * The orchestration layer (this mod: the agent loop, compaction) calls a model
 * through THIS interface and nothing else. The capability layer (mod-ai) is the
 * only package that imports the Vercel AI SDK and provides the implementation in
 * its `setup` via `engine.provideService(AI_MODEL_SERVICE, …)`. Only plain JSON
 * and ReadableStreams cross this boundary — no provider SDK types — so mod-agents
 * never depends on mod-ai or any `@ai-sdk/*` package. This generalizes the old
 * `MODEL_PROVIDER_SERVICE` override seam into a provider-neutral one.
 */

import type { OpContext } from "@pattern-js/core";
import type { ModelRef, NeutralMessage, Usage } from "./types.js";

/** A tool offered to the model for a turn (JSON-Schema parameters; engine-validated at the boundary.tool). */
export interface NeutralToolDef {
  name: string;
  description?: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /** Pause for human approval before the loop dispatches this call (HITL). */
  needsApproval?: boolean;
}

/**
 * One streamed unit from a SINGLE model step. The loop owns multi-step: it asks
 * for one step, dispatches any tool calls itself (linked sub-runs / handoffs /
 * HITL), then asks again. `finish` always closes a step and carries the complete
 * assistant message to append to history.
 */
export type NeutralChunk =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; callId: string; toolName: string; args: unknown }
  | { type: "tool-input-delta"; callId: string; delta: string }
  | { type: "tool-approval-request"; callId: string; toolName: string; args: unknown }
  | { type: "finish"; finishReason: string; usage?: Usage; message: NeutralMessage };

export interface StreamTurnInput {
  /** Which model to call; mod-ai resolves it to a concrete SDK model + key. */
  modelRef: ModelRef;
  /** The agent's instructions (system prompt). */
  system?: string;
  /** Full conversation so far, in neutral parts-based shape. */
  messages: NeutralMessage[];
  /** Tools the model may call this step (omitted-execute on the SDK side: the loop dispatches). */
  tools?: NeutralToolDef[];
  /** Resume path: approvals to apply for tools that paused for HITL. */
  toolApprovals?: Array<{ callId: string; approved: boolean }>;
  /** JSON Schema for a structured final answer (provider-enforced when supported). */
  outputSchema?: Record<string, unknown>;
  /** Cooperative cancellation for the in-flight model call. */
  signal: AbortSignal;
  /** Extra provider options merged over the ModelRef's own. */
  providerOptions?: Record<string, unknown>;
}

export interface GenerateTextInput {
  modelRef: ModelRef;
  system?: string;
  messages: NeutralMessage[];
  signal: AbortSignal;
}

export interface AiModelService {
  /** Stream ONE model step. The loop consumes chunks and drives the next step itself. */
  streamTurn(input: StreamTurnInput): AsyncIterable<NeutralChunk>;
  /** A one-shot, tool-less generation — used by history compaction. */
  generateText(input: GenerateTextInput): Promise<{ text: string; usage?: Usage }>;
}

export const AI_MODEL_SERVICE = "aiModelService";

/** Resolve the model service, with a friendly error pointing at mod-ai. */
export function aiModelService(ctx: OpContext): AiModelService {
  const svc = ctx.services[AI_MODEL_SERVICE] as AiModelService | undefined;
  if (!svc) {
    throw new Error(
      'agents need a model provider — add "@pattern-js/mod-ai" to your pattern.config.json mods ' +
        "and configure a provider in admin → Settings → AI Providers.",
    );
  }
  return svc;
}
