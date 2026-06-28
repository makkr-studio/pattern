/**
 * @pattern-js/mod-agents — the agent ops, re-hosted natively.
 *
 * `agents.agent` builds a DESCRIPTOR (plain JSON, no model work). `agents.run`
 * drives the native loop over the neutral model service (mod-ai), streaming the
 * turn-event protocol while `output`/`history` settle as values. History is
 * explicit: pull it from a store node, push the updated one back. Pre-flight
 * problems (no model provider) FAIL the node loudly; mid-turn problems (rate
 * limits, guardrail trips) become turn events and a soft outcome.
 */

import { required, stream, value, z, type OpContext, type OpDefinition } from "@pattern-js/core";
import { agentsService } from "./well-known.js";
import { aiModelService } from "./model-service.js";
import { startTurn, decodeState, type Decision, type TurnOutcome } from "./loop.js";
import {
  agentSchema,
  historySchema,
  messagePartSchema,
  modelRefSchema,
  toolsetSchema,
  turnEventSchema,
  type AgentDescriptor,
  type GuardrailDescriptor,
  type MessagePart,
  type ModelRef,
  type NeutralMessage,
  type ToolsetDescriptor,
} from "./types.js";

async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

const asArray = <T>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);

/* ── agents.agent ──────────────────────────────────────────────────────── */

const agentOp: OpDefinition = {
  type: "agents.agent",
  title: "agents.agent",
  description:
    "Define an agent (a value — wire it into agents.run, a handoff, or a tool). Wire a model from ai.model; " +
    "name/instructions default to config but can be wired at runtime to vary them per request (a wired value " +
    "overrides config); tools/guardrails/handoffs wire in as inputs. No model = the configured default.",
  config: z.object({
    name: z.string().min(1),
    /** The system prompt: what this agent does and how it answers. */
    instructions: z.string().min(1),
    /** Shown to other agents deciding whether to hand off to this one. */
    handoffDescription: z.string().optional(),
  }),
  inputs: {
    // name + instructions are config by default but ALSO wireable at runtime —
    // a wired value (even one derived from the request) overrides the config, so
    // a pipeline can vary an agent's identity per turn (e.g. chat's voice mode
    // swaps in spoken-style instructions). Unwired ⇒ the config value stands.
    name: value(z.string()),
    instructions: value(z.string()),
    model: value(modelRefSchema),
    tools: value(toolsetSchema),
    guardrails: value(), // GuardrailDescriptor | GuardrailDescriptor[]
    handoffs: value(), // AgentDescriptor | AgentDescriptor[]
  },
  outputs: { agent: value(agentSchema) },
  execute: async (ctx) => {
    const cfg = ctx.config as { name: string; instructions: string; handoffDescription?: string };
    const [nameIn, instructionsIn, model, tools, guardrailsIn, handoffsIn] = await Promise.all([
      maybe<string>(ctx, "name"),
      maybe<string>(ctx, "instructions"),
      maybe<ModelRef>(ctx, "model"),
      maybe<ToolsetDescriptor>(ctx, "tools"),
      maybe<unknown>(ctx, "guardrails"),
      maybe<unknown>(ctx, "handoffs"),
    ]);
    const guardrails = asArray<GuardrailDescriptor>(guardrailsIn);
    const handoffs = asArray<AgentDescriptor>(handoffsIn).map((h) => agentSchema.parse(h));
    const agent: AgentDescriptor = {
      kind: "agent",
      name: nameIn ?? cfg.name,
      instructions: instructionsIn ?? cfg.instructions,
      model: model ? modelRefSchema.parse(model) : undefined,
      handoffDescription: cfg.handoffDescription,
      tools,
      guardrails: guardrails.length ? guardrails : undefined,
      handoffs: handoffs.length ? handoffs : undefined,
    };
    return { agent };
  },
};

/* ── run plumbing ──────────────────────────────────────────────────────── */

const runOutputs = {
  events: stream(turnEventSchema),
  output: value(),
  history: value(historySchema),
  stopReason: value(z.enum(["complete", "interrupted", "error", "cancelled"])),
  stateToken: value(z.string().nullable()),
};

function softOutputs(outcome: Promise<TurnOutcome>) {
  return {
    output: outcome.then((o) => o.output),
    history: outcome.then((o) => o.history ?? []),
    stopReason: outcome.then((o) => o.stopReason),
    stateToken: outcome.then((o) => o.stateToken),
  };
}

/**
 * Turn-scoped abort: a STREAMING run settles for the engine before the turn
 * finishes (the SSE tail flows after result-ready), so engine.cancelRun can't
 * reach it — a Stop button aborts via AGENTS_SERVICE.abortTurn(turnId). The
 * run-level ctx.signal still chains in (editor Stop, sub-runs).
 */
function turnAbort(ctx: OpContext, turnId: string): { signal: AbortSignal; release: () => void } {
  const ctrl = new AbortController();
  const svc = agentsService(ctx);
  svc.registerTurn(turnId, ctrl);
  return { signal: AbortSignal.any([ctx.signal, ctrl.signal]), release: () => svc.releaseTurn(turnId) };
}

function looksLikeParts(v: unknown): v is MessagePart[] {
  return Array.isArray(v) && v.length > 0 && v.every((p) => messagePartSchema.safeParse(p).success);
}

/** Shape the user turn: string | parts → one user message; neutral items pass through. */
function userMessages(input: unknown): NeutralMessage[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (looksLikeParts(input)) return [{ role: "user", content: input }];
  if (Array.isArray(input)) return input as NeutralMessage[];
  throw new Error("agents.run: input must be a string, a parts array, or neutral messages");
}

const DEFAULT_MAX_TURNS = 10;

/* ── agents.run ────────────────────────────────────────────────────────── */

const runOp: OpDefinition = {
  type: "agents.run",
  title: "agents.run",
  description:
    "Run an agent: input (text or parts) + optional history in → turn events stream + final output + updated history out. " +
    "Tool calls are linked sub-runs; the events stream always terminates with `done`.",
  config: z.object({ maxTurns: z.number().int().positive().optional() }),
  inputs: {
    agent: required(agentSchema),
    input: required(),
    history: value(historySchema),
    turnId: value(z.string()),
  },
  outputs: runOutputs,
  execute: async (ctx) => {
    const [descRaw, input, history, turnId] = await Promise.all([
      ctx.input.value("agent"),
      ctx.input.value("input"),
      maybe<unknown[]>(ctx, "history"),
      maybe<string>(ctx, "turnId"),
    ]);
    const model = aiModelService(ctx); // pre-flight: loud if no provider
    const descriptor = agentSchema.parse(descRaw);
    const messages = [...((history ?? []) as NeutralMessage[]), ...userMessages(input)];
    const { maxTurns } = ctx.config as { maxTurns?: number };
    const tid = turnId ?? ctx.runId;
    const { signal, release } = turnAbort(ctx, tid);
    const { events, outcome } = startTurn({
      ctx,
      model,
      descriptor,
      messages,
      maxTurns: maxTurns ?? DEFAULT_MAX_TURNS,
      ids: { turnId: tid, runId: ctx.runId },
      signal,
    });
    void outcome.finally(release);
    return { events, ...softOutputs(outcome) };
  },
};

/* ── agents.run.resume (HITL) ──────────────────────────────────────────── */

const resumeOp: OpDefinition = {
  type: "agents.run.resume",
  title: "agents.run.resume",
  description:
    "Resume an interrupted run (HITL): the stateToken from approval.request + approve/reject decisions → the turn continues streaming.",
  config: z.object({}),
  inputs: {
    agent: required(agentSchema),
    stateToken: required(z.string()),
    /** [{ id, approved }] (or one object) matching approval.request interruptions. */
    decisions: required(),
    turnId: value(z.string()),
  },
  outputs: runOutputs,
  execute: async (ctx) => {
    const [descRaw, stateToken, decisionsIn, turnId] = await Promise.all([
      ctx.input.value("agent"),
      ctx.input.value<string>("stateToken"),
      ctx.input.value("decisions"),
      maybe<string>(ctx, "turnId"),
    ]);
    const model = aiModelService(ctx);
    const descriptor = agentSchema.parse(descRaw);
    const saved = decodeState(stateToken);
    const decisions = asArray<Decision>(decisionsIn);
    const tid = turnId ?? ctx.runId;
    const { signal, release } = turnAbort(ctx, tid);
    const { events, outcome } = startTurn({
      ctx,
      model,
      descriptor,
      messages: saved.messages,
      maxTurns: DEFAULT_MAX_TURNS,
      ids: { turnId: tid, runId: ctx.runId },
      signal,
      resume: { saved, decisions },
    });
    void outcome.finally(release);
    return { events, ...softOutputs(outcome) };
  },
};

/* ── agents.history.compact ────────────────────────────────────────────── */

const compactOp: OpDefinition = {
  type: "agents.history.compact",
  title: "agents.history.compact",
  description:
    "Squeeze a long history: items beyond keepRecent are summarized into one message (a visible node — you SEE when memory compresses). Wire a model from ai.model or use the default.",
  config: z.object({
    /** Compact only when the history exceeds this many items. */
    threshold: z.number().int().positive().default(60),
    /** Most-recent items kept verbatim. */
    keepRecent: z.number().int().positive().default(20),
  }),
  inputs: { history: required(historySchema), model: value(modelRefSchema) },
  outputs: { history: value(historySchema), compacted: value(z.boolean()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { threshold: number; keepRecent: number };
    const [history, modelRef] = await Promise.all([
      ctx.input.value<NeutralMessage[]>("history"),
      maybe<ModelRef>(ctx, "model"),
    ]);
    if (history.length <= cfg.threshold) return { history, compacted: false };

    const old = history.slice(0, history.length - cfg.keepRecent);
    const recent = history.slice(history.length - cfg.keepRecent);
    const model = aiModelService(ctx);
    const { text } = await model.generateText({
      ctx,
      modelRef,
      system:
        "Summarize the following conversation log into a compact brief that preserves facts, names, decisions and open tasks. Reply with the summary only.",
      messages: [{ role: "user", content: JSON.stringify(old) }],
      signal: ctx.signal,
    });
    const summaryItem: NeutralMessage = { role: "user", content: `[Summary of the earlier conversation]\n${text}` };
    ctx.log("info", "history compacted", { from: history.length, to: recent.length + 1 });
    return { history: [summaryItem, ...recent], compacted: true };
  },
};

/* ── agents.mcp.server ─────────────────────────────────────────────────── */

const mcpOp: OpDefinition = {
  type: "agents.mcp.server",
  title: "agents.mcp.server",
  description:
    "An MCP server as a toolset value (connection pooled by mod-ai). http: url (+headers) · stdio: command (+args). " +
    'For stdio you can paste a WHOLE command line into `command` (e.g. "docker mcp gateway run --profile X") — it is ' +
    "tokenized automatically; `args` are appended.",
  config: z.object({
    transport: z.enum(["http", "stdio"]).default("http"),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    serverLabel: z.string().optional(),
  }),
  inputs: {
    /** Auth headers for http transport — wire vault.read into a builder. */
    headers: value(z.record(z.string(), z.string())),
  },
  outputs: { toolset: value(toolsetSchema) },
  execute: async (ctx) => {
    const cfg = ctx.config as {
      transport: "http" | "stdio";
      url?: string;
      command?: string;
      args?: string[];
      serverLabel?: string;
    };
    const headers = await maybe<Record<string, string>>(ctx, "headers");
    const toolset: ToolsetDescriptor = {
      kind: "toolset",
      tools: [
        {
          origin: "mcp",
          transport: cfg.transport,
          url: cfg.url,
          headers,
          command: cfg.command,
          args: cfg.args,
          serverLabel: cfg.serverLabel,
        },
      ],
    };
    return { toolset };
  },
};

export const agentRunOps: OpDefinition[] = [agentOp, runOp, resumeOp, compactOp, mcpOp];
