/**
 * @pattern/mod-agents-openai — the `agents.*` provider ops.
 *
 * `agents.agent` builds DESCRIPTORS (plain JSON, no SDK work); `agents.run`
 * reifies + runs them — always streaming internally, emitting the neutral
 * turn-event protocol on its `events` port while `output`/`history` settle as
 * values. History is explicit: pull it from a store node, push the updated
 * one back — agents and conversations are different things.
 *
 * Pre-flight problems (missing API key, unknown tool) FAIL the node loudly;
 * mid-turn problems (rate limits, guardrail trips) become turn events and a
 * soft outcome — errors are content a chat can render.
 */

import { Agent, OpenAIProvider, RunState, Runner, type AgentInputItem } from "@openai/agents";
import { required, stream, value, z, type OpContext, type OpDefinition } from "@pattern/core";
import {
  agentSchema,
  agentsService,
  guardrailSchema,
  historySchema,
  toolsetSchema,
  turnEventSchema,
  type AgentDescriptor,
  type GuardrailDescriptor,
  type ToolsetDescriptor,
} from "@pattern/mod-agents";
import { reifyAgent } from "./reify.js";
import { pumpTurn, type TurnOutcome } from "./events.js";
import { toInputItems } from "./input.js";
import { MODEL_PROVIDER_SERVICE } from "./well-known.js";

async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

/* ── agents.agent ──────────────────────────────────────────────────────── */

const agentOp: OpDefinition = {
  type: "agents.agent",
  title: "agents.agent",
  description:
    "Define an agent (a value — wire it into agents.run, a handoff, or agents.tool.agent). Tools/guardrails/handoffs wire in as inputs.",
  config: z.object({
    name: z.string().min(1),
    /** The system prompt: what this agent does and how it answers. */
    instructions: z.string().min(1),
    /** Model name (empty = SDK default). */
    model: z.string().optional(),
    /** Provider model settings (temperature, reasoning…). */
    modelSettings: z.record(z.string(), z.unknown()).optional(),
    /** Shown to other agents deciding whether to hand off to this one. */
    handoffDescription: z.string().optional(),
  }),
  configInputs: {
    name: value(z.string()),
    instructions: value(z.string()),
    model: value(z.string()),
  },
  inputs: {
    tools: value(toolsetSchema),
    guardrails: value(), // GuardrailDescriptor | GuardrailDescriptor[]
    handoffs: value(), // AgentDescriptor | AgentDescriptor[]
  },
  outputs: { agent: value(agentSchema) },
  execute: async (ctx) => {
    const cfg = ctx.config as {
      name: string;
      instructions: string;
      model?: string;
      modelSettings?: Record<string, unknown>;
      handoffDescription?: string;
    };
    const [tools, guardrailsIn, handoffsIn] = await Promise.all([
      maybe<ToolsetDescriptor>(ctx, "tools"),
      maybe<unknown>(ctx, "guardrails"),
      maybe<unknown>(ctx, "handoffs"),
    ]);
    const asArray = <T>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);
    const guardrails = asArray<GuardrailDescriptor>(guardrailsIn).map((g) => guardrailSchema.parse(g));
    const handoffs = asArray<AgentDescriptor>(handoffsIn).map((h) => agentSchema.parse(h));
    const agent: AgentDescriptor = {
      kind: "agent",
      name: cfg.name,
      instructions: cfg.instructions,
      model: cfg.model,
      modelSettings: cfg.modelSettings,
      handoffDescription: cfg.handoffDescription,
      tools,
      guardrails: guardrails.length ? guardrails : undefined,
      handoffs: handoffs.length ? handoffs : undefined,
    };
    return { agent };
  },
};

/* ── runner plumbing ───────────────────────────────────────────────────── */

function makeRunner(ctx: OpContext, apiKey: string | undefined): Runner {
  const override = ctx.services[MODEL_PROVIDER_SERVICE];
  if (override) {
    return new Runner({ modelProvider: override as never, tracingDisabled: true });
  }
  const key = apiKey ?? ctx.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "agents: no API key — wire vault.read (or core env) into apiKey, or set OPENAI_API_KEY",
    );
  }
  // Pattern's tracing is the source of truth; the SDK exporter stays off.
  return new Runner({ modelProvider: new OpenAIProvider({ apiKey: key }), tracingDisabled: true });
}

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
 * reach it — a Stop button aborts via AGENTS_SERVICE.abortTurn(turnId)
 * instead. The run-level ctx.signal still chains in (editor Stop, sub-runs).
 */
function turnAbort(ctx: OpContext, turnId: string): { signal: AbortSignal; release: () => void } {
  const ctrl = new AbortController();
  const svc = agentsService(ctx);
  svc.registerTurn(turnId, ctrl);
  return {
    signal: AbortSignal.any([ctx.signal, ctrl.signal]),
    release: () => svc.releaseTurn(turnId),
  };
}

/* ── agents.run ────────────────────────────────────────────────────────── */

const runOp: OpDefinition = {
  type: "agents.run",
  title: "agents.run",
  description:
    "Run an agent: input (text or parts) + optional history in → turn events stream + final output + updated history out. " +
    "Tool calls are linked sub-runs; the events stream always terminates with `done`.",
  config: z.object({
    /** Safety cap on model↔tool round-trips. */
    maxTurns: z.number().int().positive().optional(),
  }),
  inputs: {
    agent: required(agentSchema),
    input: required(),
    history: value(historySchema),
    apiKey: value(z.string()),
    turnId: value(z.string()),
  },
  outputs: runOutputs,
  execute: async (ctx) => {
    const [desc, input, history, apiKey, turnId] = await Promise.all([
      ctx.input.value<AgentDescriptor>("agent"),
      ctx.input.value("input"),
      maybe<unknown[]>(ctx, "history"),
      maybe<string>(ctx, "apiKey"),
      maybe<string>(ctx, "turnId"),
    ]);
    const runner = makeRunner(ctx, apiKey);
    const agent = await reifyAgent(agentSchema.parse(desc), ctx);
    const turnItems = await toInputItems(input, ctx);
    const items = [...((history ?? []) as AgentInputItem[]), ...turnItems];
    const { maxTurns } = ctx.config as { maxTurns?: number };

    const tid = turnId ?? ctx.runId;
    const { signal, release } = turnAbort(ctx, tid);
    const streamed = await runner.run(agent, items, { stream: true, maxTurns, signal });
    const { events, outcome } = pumpTurn(streamed as never, { turnId: tid, runId: ctx.runId }, signal);
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
    apiKey: value(z.string()),
    turnId: value(z.string()),
  },
  outputs: runOutputs,
  execute: async (ctx) => {
    const [desc, stateToken, decisionsIn, apiKey, turnId] = await Promise.all([
      ctx.input.value<AgentDescriptor>("agent"),
      ctx.input.value<string>("stateToken"),
      ctx.input.value("decisions"),
      maybe<string>(ctx, "apiKey"),
      maybe<string>(ctx, "turnId"),
    ]);
    const runner = makeRunner(ctx, apiKey);
    const agent = await reifyAgent(agentSchema.parse(desc), ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = await RunState.fromString(agent as Agent<any, any>, stateToken);

    const decisions = (Array.isArray(decisionsIn) ? decisionsIn : [decisionsIn]) as Array<{
      id: string;
      approved: boolean;
    }>;
    const pending = state.getInterruptions();
    for (const decision of decisions) {
      const item = pending.find((p) => {
        const raw = (p as { rawItem?: { callId?: string; id?: string } }).rawItem ?? {};
        return raw.callId === decision.id || raw.id === decision.id;
      });
      if (!item) throw new Error(`agents.run.resume: no pending approval with id "${decision.id}"`);
      if (decision.approved) state.approve(item);
      else state.reject(item);
    }

    const tid = turnId ?? ctx.runId;
    const { signal, release } = turnAbort(ctx, tid);
    const streamed = await runner.run(agent, state as never, { stream: true, signal });
    const { events, outcome } = pumpTurn(streamed as never, { turnId: tid, runId: ctx.runId }, signal);
    void outcome.finally(release);
    return { events, ...softOutputs(outcome) };
  },
};

/* ── agents.mcp.server ─────────────────────────────────────────────────── */

const mcpOp: OpDefinition = {
  type: "agents.mcp.server",
  title: "agents.mcp.server",
  description:
    "An MCP server as a toolset value (connection pooled for the process). http: url (+headers) · stdio: command (+args).",
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

/* ── agents.history.compact ────────────────────────────────────────────── */

const compactOp: OpDefinition = {
  type: "agents.history.compact",
  title: "agents.history.compact",
  description:
    "Squeeze a long history: items beyond keepRecent are summarized into one message (a visible node — you SEE when memory compresses).",
  config: z.object({
    /** Compact only when the history exceeds this many items. */
    threshold: z.number().int().positive().default(60),
    /** Most-recent items kept verbatim. */
    keepRecent: z.number().int().positive().default(20),
    /** Summarizer model (empty = SDK default). */
    model: z.string().optional(),
  }),
  inputs: { history: required(historySchema), apiKey: value(z.string()) },
  outputs: { history: value(historySchema), compacted: value(z.boolean()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { threshold: number; keepRecent: number; model?: string };
    const [history, apiKey] = await Promise.all([
      ctx.input.value<unknown[]>("history"),
      maybe<string>(ctx, "apiKey"),
    ]);
    if (history.length <= cfg.threshold) return { history, compacted: false };

    const old = history.slice(0, history.length - cfg.keepRecent);
    const recent = history.slice(history.length - cfg.keepRecent);
    const runner = makeRunner(ctx, apiKey);
    const summarizer = new Agent({
      name: "history-compactor",
      instructions:
        "Summarize the following conversation log into a compact brief that preserves facts, names, decisions and open tasks. Reply with the summary only.",
      ...(cfg.model ? { model: cfg.model } : {}),
    });
    const result = await runner.run(summarizer, JSON.stringify(old), { signal: ctx.signal });
    const summary = typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput);
    const summaryItem = {
      role: "user",
      content: `[Summary of the earlier conversation]\n${summary}`,
    };
    ctx.log("info", "history compacted", { from: history.length, to: recent.length + 1 });
    return { history: [summaryItem, ...recent], compacted: true };
  },
};

/* ── agents.realtime.key (voice pre-wiring) ────────────────────────────── */

const realtimeKeyOp: OpDefinition = {
  type: "agents.realtime.key",
  title: "agents.realtime.key",
  description:
    "Mint an ephemeral realtime client secret (ek_…) for browser↔OpenAI voice sessions — the backend half of the future voice surface.",
  config: z.object({ model: z.string().default("gpt-realtime") }),
  inputs: { apiKey: value(z.string()) },
  outputs: { ephemeralKey: value(z.string()), expiresAt: value(z.number()) },
  execute: async (ctx) => {
    const apiKey = (await maybe<string>(ctx, "apiKey")) ?? ctx.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("agents: no API key for realtime client secret");
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ session: { type: "realtime", model: (ctx.config as { model: string }).model } }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`agents: client_secrets failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { value?: string; expires_at?: number; client_secret?: { value: string; expires_at: number } };
    const secret = data.client_secret ?? (data as { value: string; expires_at: number });
    return { ephemeralKey: secret.value, expiresAt: secret.expires_at };
  },
};

export const openaiAgentOps: OpDefinition[] = [agentOp, runOp, resumeOp, mcpOp, compactOp, realtimeKeyOp];
