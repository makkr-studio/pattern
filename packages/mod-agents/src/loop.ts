/**
 * @pattern-js/mod-agents — the native agent run loop.
 *
 * Replaces the @openai/agents Runner: we drive the model↔tool turn loop
 * ourselves over the neutral AiModelService (mod-ai implements it). Each model
 * step is a single `streamTurn` call; THIS loop owns multi-step. Tools are
 * linked sub-runs (`ctx.invoke`) / op-registry calls / MCP; handoffs swap the
 * active agent; guardrails are tool sub-runs; HITL pauses with a stateToken.
 *
 * It emits the neutral `turnEventSchema` and the produced stream ALWAYS
 * terminates with a `done` event — complete | interrupted | error | cancelled.
 */

import type { OpContext } from "@pattern-js/core";
import { agentsService } from "./well-known.js";
import { aiMcpService, type AiModelService, type NeutralToolDef } from "./model-service.js";
import type {
  AgentDescriptor,
  GuardrailDescriptor,
  MessagePart,
  NeutralMessage,
  ToolsetDescriptor,
  TurnEvent,
  TurnStopReason,
} from "./types.js";

interface Ids {
  turnId: string;
  runId: string;
}

export interface TurnOutcome {
  stopReason: TurnStopReason;
  /** Final text/structured output; null on error/interruption/cancel. */
  output: unknown;
  /** Full neutral history after the run; null on hard failure/cancel. */
  history: NeutralMessage[] | null;
  /** Serialized loop state when interrupted (HITL resume token). */
  stateToken: string | null;
}

export interface Decision {
  id: string;
  approved: boolean;
}

/** A pending tool call buffered for human approval. */
interface Pending {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** The serialized HITL state (opaque to consumers; this loop owns the shape). */
interface SavedState {
  messages: NeutralMessage[];
  activeAgent: string;
  pending: Pending[];
}

const encodeState = (s: SavedState): string => JSON.stringify(s);
const decodeState = (t: string): SavedState => JSON.parse(t) as SavedState;

/** How a resolved tool is actually run. */
interface Dispatcher {
  needsApproval: boolean;
  invoke(args: Record<string, unknown>): Promise<unknown>;
}

interface ResolvedAgent {
  descriptor: AgentDescriptor;
  tools: NeutralToolDef[];
  dispatch: Map<string, Dispatcher>;
  /** synthetic transfer-tool name → target agent. */
  handoffs: Map<string, AgentDescriptor>;
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const transferName = (name: string): string => `transfer_to_${slug(name)}`;

/** Plain text of a message's content (for guardrail payloads). */
function textOfContent(content: string | MessagePart[]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function lastUserText(messages: NeutralMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return textOfContent(messages[i]!.content);
  }
  return "";
}

/**
 * Resolve a descriptor's toolset + handoffs into model-facing tools and
 * dispatchers. Workflow tools become linked sub-runs; op tools call the
 * registry; MCP tools resolve through mod-ai's MCP seam. Throws loudly for an
 * unknown op tool (pre-flight, when called from the op's execute).
 */
async function resolveAgent(descriptor: AgentDescriptor, ctx: OpContext): Promise<ResolvedAgent> {
  const tools: NeutralToolDef[] = [];
  const dispatch = new Map<string, Dispatcher>();
  const handoffs = new Map<string, AgentDescriptor>();
  const svc = agentsService(ctx);

  const addToolset = async (toolset: ToolsetDescriptor | undefined) => {
    for (const ref of toolset?.tools ?? []) {
      if (ref.origin === "workflow") {
        tools.push({
          name: ref.name,
          description: ref.description,
          parameters: ref.params ?? { type: "object", properties: {} },
          needsApproval: ref.needsApproval,
        });
        dispatch.set(ref.name, {
          needsApproval: ref.needsApproval ?? false,
          invoke: async (args) => {
            ctx.trace.addEvent("tool.call", { tool: ref.name, workflowId: ref.workflowId });
            const outputs = await ctx.invoke({ workflowId: ref.workflowId }, { args });
            return outputs.result === undefined ? outputs : outputs.result;
          },
        });
      } else if (ref.origin === "op") {
        const reg = svc.getOpTool(ref.name);
        if (!reg) {
          throw new Error(`agents: no registered op tool named "${ref.name}" (mods register them in setup)`);
        }
        tools.push({ name: reg.name, description: reg.description, parameters: reg.params, needsApproval: ref.needsApproval ?? reg.needsApproval });
        dispatch.set(reg.name, {
          needsApproval: (ref.needsApproval ?? reg.needsApproval) ?? false,
          invoke: async (args) => reg.execute(args, ctx),
        });
      } else {
        // MCP: discovery + execution live in mod-ai (keeps the MCP client out of
        // this provider-SDK-free package).
        const mcp = aiMcpService(ctx);
        for (const t of await mcp.listTools(ref)) {
          tools.push(t);
          dispatch.set(t.name, {
            needsApproval: t.needsApproval ?? false,
            invoke: async (args) => mcp.callTool(ref, t.name, args),
          });
        }
      }
    }
  };

  await addToolset(descriptor.tools);
  for (const h of descriptor.handoffs ?? []) {
    const name = transferName(h.name);
    handoffs.set(name, h);
    tools.push({
      name,
      description: h.handoffDescription ?? `Hand off the conversation to ${h.name}.`,
      parameters: { type: "object", properties: {} },
    });
  }
  return { descriptor, tools, dispatch, handoffs };
}

const guardrailsOf = (d: AgentDescriptor, dir: "input" | "output"): GuardrailDescriptor[] =>
  (d.guardrails ?? []).filter((g) => g.direction === dir);

/** Run a guardrail tool workflow; returns whether it tripped. */
async function runGuardrail(g: GuardrailDescriptor, text: string, ctx: OpContext): Promise<boolean> {
  const outputs = await ctx.invoke({ workflowId: g.workflowId }, { args: { input: text, direction: g.direction } });
  const result = (outputs.result ?? outputs) as { tripwire?: unknown };
  return Boolean(result.tripwire);
}

export interface StartTurnParams {
  ctx: OpContext;
  model: AiModelService;
  descriptor: AgentDescriptor;
  /** Conversation so far (history + the new user turn). */
  messages: NeutralMessage[];
  maxTurns: number;
  ids: Ids;
  signal: AbortSignal;
  /** Resume path: decisions to apply against the saved pending approvals. */
  resume?: { saved: SavedState; decisions: Decision[] };
}

/**
 * Run an agent turn (fresh or resumed). Returns the neutral event stream plus a
 * settled outcome. Mirrors the old `pumpTurn` contract: the stream never
 * rejects and always closes with `done`.
 */
export function startTurn(params: StartTurnParams): {
  events: ReadableStream<TurnEvent>;
  outcome: Promise<TurnOutcome>;
} {
  const { ctx, model, descriptor, ids, signal, maxTurns } = params;
  let resolveOutcome!: (o: TurnOutcome) => void;
  const outcome = new Promise<TurnOutcome>((r) => (resolveOutcome = r));

  const events = new ReadableStream<TurnEvent>({
    start: async (controller) => {
      const emit = (ev: TurnEvent) => controller.enqueue(ev);
      const settle = (o: TurnOutcome) => resolveOutcome(o);

      const findAgent = (name: string): AgentDescriptor => {
        const walk = (a: AgentDescriptor): AgentDescriptor | undefined => {
          if (a.name === name) return a;
          for (const h of a.handoffs ?? []) {
            const hit = walk(h);
            if (hit) return hit;
          }
          return undefined;
        };
        return walk(descriptor) ?? descriptor;
      };

      try {
        const messages: NeutralMessage[] = [...params.messages];
        let active = await resolveAgent(
          params.resume ? findAgent(params.resume.saved.activeAgent) : descriptor,
          ctx,
        );

        // ── resume: apply the human's decisions to the pending approvals ──
        if (params.resume) {
          for (const d of params.resume.decisions) {
            const p = params.resume.saved.pending.find((x) => x.callId === d.id);
            if (!p) throw new Error(`agents.run.resume: no pending approval with id "${d.id}"`);
            if (d.approved) {
              const disp = active.dispatch.get(p.toolName);
              emit({ ...ids, type: "tool.activity", toolName: p.toolName, callId: p.callId, phase: "start", args: p.args });
              try {
                const result = disp ? await disp.invoke(p.args) : undefined;
                emit({ ...ids, type: "tool.activity", toolName: p.toolName, callId: p.callId, phase: "done", result });
                messages.push({ role: "tool", toolCallId: p.callId, toolName: p.toolName, content: stringifyResult(result) });
              } catch (err) {
                emit({ ...ids, type: "tool.activity", toolName: p.toolName, callId: p.callId, phase: "error", error: errMessage(err) });
                messages.push({ role: "tool", toolCallId: p.callId, toolName: p.toolName, content: `error: ${errMessage(err)}` });
              }
            } else {
              messages.push({ role: "tool", toolCallId: p.callId, toolName: p.toolName, content: "The user declined this tool call." });
            }
          }
        } else {
          // ── input guardrails (fresh runs only) ──
          for (const g of guardrailsOf(active.descriptor, "input")) {
            if (await runGuardrail(g, lastUserText(messages), ctx)) {
              emit({ ...ids, type: "error", message: `input guardrail "${g.name}" tripped`, code: "guardrail.input" });
              emit({ ...ids, type: "done", stopReason: "error" });
              return settle({ stopReason: "error", output: null, history: null, stateToken: null });
            }
          }
        }

        // ── the turn loop ──
        for (let turn = 0; ; turn++) {
          if (turn >= maxTurns) {
            emit({ ...ids, type: "error", message: `max turns (${maxTurns}) exceeded`, code: "max_turns" });
            emit({ ...ids, type: "done", stopReason: "error" });
            return settle({ stopReason: "error", output: null, history: null, stateToken: null });
          }

          let text = "";
          const toolCalls: Array<{ callId: string; toolName: string; args: Record<string, unknown> }> = [];
          for await (const chunk of model.streamTurn({
            modelRef: active.descriptor.model,
            system: active.descriptor.instructions,
            // A snapshot: the loop mutates `messages` after the step settles.
            messages: [...messages],
            tools: active.tools,
            outputSchema: active.descriptor.outputSchema,
            signal,
          })) {
            if (chunk.type === "text-delta") {
              text += chunk.delta;
              emit({ ...ids, type: "text.delta", delta: chunk.delta });
            } else if (chunk.type === "tool-call" || chunk.type === "tool-approval-request") {
              toolCalls.push({ callId: chunk.callId, toolName: chunk.toolName, args: (chunk.args ?? {}) as Record<string, unknown> });
            }
            // `finish` and `tool-input-delta` carry no extra events here.
          }
          if (signal.aborted) {
            emit({ ...ids, type: "done", stopReason: "cancelled" });
            return settle({ stopReason: "cancelled", output: null, history: null, stateToken: null });
          }

          // Record the assistant step.
          messages.push({
            role: "assistant",
            content: text,
            toolCalls: toolCalls.length ? toolCalls.map((t) => ({ callId: t.callId, toolName: t.toolName, args: t.args })) : undefined,
          });
          if (text) emit({ ...ids, type: "text.done", text });

          // No tool calls → final answer.
          if (toolCalls.length === 0) {
            for (const g of guardrailsOf(active.descriptor, "output")) {
              if (await runGuardrail(g, text, ctx)) {
                emit({ ...ids, type: "error", message: `output guardrail "${g.name}" tripped`, code: "guardrail.output" });
                emit({ ...ids, type: "done", stopReason: "error" });
                return settle({ stopReason: "error", output: null, history: null, stateToken: null });
              }
            }
            const output = active.descriptor.outputSchema ? tryParse(text) : text;
            emit({ ...ids, type: "done", stopReason: "complete" });
            return settle({ stopReason: "complete", output, history: messages, stateToken: null });
          }

          // A handoff outranks everything else this step.
          const handoff = toolCalls.find((t) => active.handoffs.has(t.toolName));
          if (handoff) {
            emit({ ...ids, type: "tool.activity", toolName: "handoff", callId: handoff.callId, phase: "start", args: { to: active.handoffs.get(handoff.toolName)!.name } });
            active = await resolveAgent(active.handoffs.get(handoff.toolName)!, ctx);
            emit({ ...ids, type: "tool.activity", toolName: "handoff", callId: handoff.callId, phase: "done" });
            continue;
          }

          // Split into pending-approval vs dispatch-now.
          const pending: Pending[] = [];
          for (const tc of toolCalls) {
            const disp = active.dispatch.get(tc.toolName);
            if (disp?.needsApproval) {
              pending.push(tc);
              continue;
            }
            emit({ ...ids, type: "tool.activity", toolName: tc.toolName, callId: tc.callId, phase: "start", args: tc.args });
            try {
              const result = disp ? await disp.invoke(tc.args) : `error: unknown tool "${tc.toolName}"`;
              emit({ ...ids, type: "tool.activity", toolName: tc.toolName, callId: tc.callId, phase: "done", result });
              messages.push({ role: "tool", toolCallId: tc.callId, toolName: tc.toolName, content: stringifyResult(result) });
            } catch (err) {
              emit({ ...ids, type: "tool.activity", toolName: tc.toolName, callId: tc.callId, phase: "error", error: errMessage(err) });
              messages.push({ role: "tool", toolCallId: tc.callId, toolName: tc.toolName, content: `error: ${errMessage(err)}` });
            }
          }

          // Anything awaiting approval pauses the turn (HITL).
          if (pending.length) {
            const stateToken = encodeState({ messages, activeAgent: active.descriptor.name, pending });
            for (const p of pending) {
              emit({ ...ids, type: "approval.request", interruption: { id: p.callId, toolName: p.toolName, args: p.args }, stateToken });
            }
            emit({ ...ids, type: "done", stopReason: "interrupted" });
            return settle({ stopReason: "interrupted", output: null, history: messages, stateToken });
          }
          // else: dispatched tools → loop for the next model step.
        }
      } catch (err) {
        if (signal.aborted) {
          emit({ ...ids, type: "done", stopReason: "cancelled" });
          settle({ stopReason: "cancelled", output: null, history: null, stateToken: null });
        } else {
          emit({ ...ids, type: "error", message: errMessage(err), code: errorCode(err) });
          emit({ ...ids, type: "done", stopReason: "error" });
          settle({ stopReason: "error", output: null, history: null, stateToken: null });
        }
      } finally {
        controller.close();
      }
    },
  });

  return { events, outcome };
}

/** Re-expose the saved state shape for the resume op. */
export { decodeState };

function stringifyResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result ?? null);
}
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function errorCode(err: unknown): string | undefined {
  const name = (err as { name?: string })?.name ?? "";
  if (/Abort/.test(name)) return undefined;
  return undefined;
}
function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
