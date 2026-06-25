/**
 * @pattern-js/mod-agents — the neutral contracts.
 *
 * Two families of shapes, both PLAIN JSON (structured-cloneable: they flow on
 * edges and may cross worker boundaries — provider SDK objects never do; a
 * provider mod reifies descriptors into SDK instances at execute time):
 *
 *  - **Descriptors** — what an agent/toolset/guardrail value IS on the canvas.
 *  - **Turn events** — the modality-agnostic stream a running agent emits
 *    (text deltas, tool activity, approval requests, a guaranteed terminal
 *    event). Chat UIs, stores and SSE responses all speak this one protocol;
 *    voice surfaces later consume the same stream (`audio.ref` is reserved).
 *
 * Message content is PARTS-based from day one (text | image_ref) — retrofitting
 * parts into string messages is the painful version.
 */

import { z } from "@pattern-js/core";

/* ── message parts ─────────────────────────────────────────────────────── */

export const messagePartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_ref"),
    /** A blob id (mod-store) — providers inline it (e.g. base64 data URL). */
    blobId: z.string(),
    mime: z.string().optional(),
  }),
]);
export type MessagePart = z.infer<typeof messagePartSchema>;

/**
 * Conversation history: provider-shaped items, treated as OPAQUE by everything
 * except the provider mod that produced them (pull from the store → agent run
 * → push back). Keeping them opaque lets each provider use its native item
 * format losslessly.
 */
export const historySchema = z.array(z.unknown());
export type History = unknown[];

/* ── model reference ───────────────────────────────────────────────────── */

/**
 * A provider-neutral reference to a model. Plain JSON, structured-cloneable, it
 * flows on a value port into every capability op and into an agent. The CAPABILITY
 * layer (mod-ai) turns it into a concrete SDK model; the neutral layer only ever
 * passes it around. Routing is first-class: `direct` (a native provider package +
 * a provider key) or `gateway` (the Vercel AI Gateway, one key, `provider/model` ids).
 */
export const modelRefSchema = z.object({
  kind: z.literal("model"),
  routing: z.enum(["direct", "gateway"]),
  modality: z
    .enum(["language", "embedding", "image", "speech", "transcription", "video"])
    .default("language"),
  /** direct: provider package id ("openai"); gateway: the provider half of "provider/model". */
  provider: z.string(),
  /** direct: bare model id ("gpt-5"); gateway: the full "provider/model" string. */
  modelId: z.string(),
  /** Vault secret NAME to resolve the key (defaults per routing/provider in mod-ai). */
  credential: z.string().optional(),
  /**
   * Optional reference to a named mod-ai **Connection** (provider + routing +
   * explicitly-chosen vault secrets, incl. structured creds for Azure/Bedrock/
   * Vertex). When set, mod-ai resolves provider/routing/keys from it; the inline
   * fields above stay for display/catalog. This is what `ai.alias` produces.
   */
  connection: z.string().optional(),
  /** Pass-through provider options (temperature, reasoning, dimensions, voice…). */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});
export type ModelRef = z.infer<typeof modelRefSchema>;

/** Token accounting common to every generation, when the provider reports it. */
export const usageSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
  })
  .partial();
export type Usage = z.infer<typeof usageSchema>;

/**
 * A provider-neutral chat message (parts-based content, reusing messagePartSchema).
 * The agent loop owns history losslessly in this shape; mod-ai maps it to/from the
 * AI SDK's message format. `tool` messages carry the call linkage; an `assistant`
 * message may carry the tool calls it requested.
 */
export const neutralMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(messagePartSchema)]),
  /** tool result messages: which call this answers. */
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  /** assistant messages: the tool calls requested this step. */
  toolCalls: z
    .array(z.object({ callId: z.string(), toolName: z.string(), args: z.unknown() }))
    .optional(),
});
export type NeutralMessage = z.infer<typeof neutralMessageSchema>;

/* ── descriptors ───────────────────────────────────────────────────────── */

export const toolRefSchema = z.discriminatedUnion("origin", [
  z.object({
    origin: z.literal("workflow"),
    workflowId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    /** JSON Schema for the tool arguments (engine-enforced via boundary.tool). */
    params: z.record(z.string(), z.unknown()).optional(),
    /** Pause for human approval before each call (HITL). */
    needsApproval: z.boolean().optional(),
  }),
  z.object({
    origin: z.literal("mcp"),
    transport: z.enum(["http", "stdio"]),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    serverLabel: z.string().optional(),
  }),
  z.object({
    origin: z.literal("op"),
    /** Name in the AGENTS_SERVICE op-tool registry (mods register in setup). */
    name: z.string(),
    needsApproval: z.boolean().optional(),
  }),
]);
export type ToolRef = z.infer<typeof toolRefSchema>;

export const toolsetSchema = z.object({
  kind: z.literal("toolset"),
  tools: z.array(toolRefSchema),
});
export type ToolsetDescriptor = z.infer<typeof toolsetSchema>;

export const guardrailSchema = z.object({
  kind: z.literal("guardrail"),
  direction: z.enum(["input", "output"]),
  /** A boundary.tool workflow returning { tripwire: boolean, info?: unknown }. */
  workflowId: z.string(),
  name: z.string(),
});
export type GuardrailDescriptor = z.infer<typeof guardrailSchema>;

export interface AgentDescriptor {
  kind: "agent";
  name: string;
  instructions: string;
  /** The model to run on (wire an ai.model node). Undefined = the configured default. */
  model?: ModelRef;
  tools?: ToolsetDescriptor;
  guardrails?: GuardrailDescriptor[];
  /** Other agents this one may hand off to. */
  handoffs?: AgentDescriptor[];
  handoffDescription?: string;
  /** JSON Schema for structured final output (provider-enforced). */
  outputSchema?: Record<string, unknown>;
}

export const agentSchema: z.ZodType<AgentDescriptor> = z.lazy(() =>
  z.object({
    kind: z.literal("agent"),
    name: z.string(),
    instructions: z.string(),
    model: modelRefSchema.optional(),
    tools: toolsetSchema.optional(),
    guardrails: z.array(guardrailSchema).optional(),
    handoffs: z.array(agentSchema).optional(),
    handoffDescription: z.string().optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  }),
) as z.ZodType<AgentDescriptor>;

/* ── the turn event protocol ───────────────────────────────────────────── */

const base = { turnId: z.string(), runId: z.string() };

export const turnEventSchema = z.discriminatedUnion("type", [
  /** Streaming text. */
  z.object({ ...base, type: z.literal("text.delta"), delta: z.string() }),
  /** A complete assistant message (also emitted after deltas). */
  z.object({ ...base, type: z.literal("text.done"), text: z.string() }),
  /** Tool lifecycle: start → done | error. Args/results may be elided/truncated. */
  z.object({
    ...base,
    type: z.literal("tool.activity"),
    toolName: z.string(),
    callId: z.string().optional(),
    phase: z.enum(["start", "done", "error"]),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    /** Set when the tool ran as a linked sub-run (deep-link into the admin). */
    subRunId: z.string().optional(),
  }),
  /** Reserved for the voice round: a chunk of audio parked as a blob. */
  z.object({ ...base, type: z.literal("audio.ref"), blobId: z.string(), mime: z.string() }),
  /** HITL: the turn paused awaiting approval; resume via the provider mod. */
  z.object({
    ...base,
    type: z.literal("approval.request"),
    interruption: z.object({ id: z.string(), toolName: z.string(), args: z.unknown() }),
    /** Opaque serialized run state — only the provider mod reads it. */
    stateToken: z.string(),
  }),
  /** An error, as turn CONTENT (chat UIs render an inline card, not a toast). */
  z.object({ ...base, type: z.literal("error"), message: z.string(), code: z.string().optional() }),
  /** GUARANTEED terminal event — a consumer can always settle on `done`. */
  z.object({
    ...base,
    type: z.literal("done"),
    stopReason: z.enum(["complete", "interrupted", "error", "cancelled"]),
  }),
]);
export type TurnEvent = z.infer<typeof turnEventSchema>;
export type TurnStopReason = Extract<TurnEvent, { type: "done" }>["stopReason"];
