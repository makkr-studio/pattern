/**
 * @pattern-js/mod-agents-openai — SDK stream → turn-event protocol.
 *
 * One mapping, three consumers (SSE response, store sink, future voice
 * surface). The contract that matters: the produced stream ALWAYS ends with
 * a `done` event — complete, interrupted (HITL), error (as turn content,
 * guardrail trips included) or cancelled.
 */

import type { RunItemStreamEvent, RunStreamEvent, StreamedRunResult } from "@openai/agents";
import type { TurnEvent, TurnStopReason } from "@pattern-js/mod-agents";

interface Ids {
  turnId: string;
  runId: string;
}

/** Best-effort extraction from protocol items (defensive: shapes evolve). */
function rawOf(item: unknown): Record<string, unknown> {
  return ((item as { rawItem?: unknown }).rawItem ?? {}) as Record<string, unknown>;
}

function parseArgs(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function messageText(item: unknown): string {
  const raw = rawOf(item);
  const content = raw.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .join("");
  }
  return "";
}

function mapItemEvent(ev: RunItemStreamEvent, ids: Ids): TurnEvent | undefined {
  const raw = rawOf(ev.item);
  const callId = typeof raw.callId === "string" ? raw.callId : undefined;
  switch (ev.name) {
    case "tool_called":
      return {
        ...ids,
        type: "tool.activity",
        toolName: typeof raw.name === "string" ? raw.name : "tool",
        callId,
        phase: "start",
        args: parseArgs(raw.arguments),
      };
    case "tool_output": {
      const out = (ev.item as { output?: unknown }).output;
      return {
        ...ids,
        type: "tool.activity",
        toolName: typeof raw.name === "string" ? raw.name : "tool",
        callId,
        phase: "done",
        result: typeof out === "string" ? parseArgs(out) : out,
      };
    }
    case "handoff_requested":
      return { ...ids, type: "tool.activity", toolName: "handoff", callId, phase: "start" };
    case "handoff_occurred":
      return { ...ids, type: "tool.activity", toolName: "handoff", callId, phase: "done" };
    case "message_output_created":
      return { ...ids, type: "text.done", text: messageText(ev.item) };
    default:
      return undefined;
  }
}

function mapEvent(ev: RunStreamEvent, ids: Ids): TurnEvent | undefined {
  if (ev.type === "raw_model_stream_event") {
    // The SDK normalizes raw model events: text arrives as `output_text_delta`.
    const data = ev.data as { type?: string; delta?: unknown };
    if (data?.type === "output_text_delta" && typeof data.delta === "string") {
      return { ...ids, type: "text.delta", delta: data.delta };
    }
    return undefined;
  }
  if (ev.type === "run_item_stream_event") return mapItemEvent(ev, ids);
  return undefined; // agent_updated_stream_event — internal
}

export interface TurnOutcome {
  stopReason: TurnStopReason;
  /** Final text (or structured) output; null on error/interruption. */
  output: unknown;
  /** Full history after the run (input + new items); null on hard failure. */
  history: unknown[] | null;
  /** Serialized RunState when interrupted (HITL resume token). */
  stateToken: string | null;
  /** Pending approvals when interrupted. */
  interruptions: Array<{ id: string; toolName: string; args: unknown }>;
}

const errorCode = (err: unknown): string | undefined => {
  const name = (err as { name?: string })?.name ?? "";
  if (/InputGuardrail/.test(name)) return "guardrail.input";
  if (/OutputGuardrail/.test(name)) return "guardrail.output";
  if (/MaxTurns/.test(name)) return "max_turns";
  if (/ModelBehavior/.test(name)) return "model_behavior";
  return undefined;
};

/**
 * Pump a streamed SDK run into a TurnEvent ReadableStream and a settled
 * outcome. The stream NEVER rejects and ALWAYS terminates with `done`.
 */
export function pumpTurn(
  streamed: StreamedRunResult<unknown, never>,
  ids: Ids,
  signal: AbortSignal,
): { events: ReadableStream<TurnEvent>; outcome: Promise<TurnOutcome> } {
  let resolveOutcome!: (o: TurnOutcome) => void;
  const outcome = new Promise<TurnOutcome>((r) => (resolveOutcome = r));

  const events = new ReadableStream<TurnEvent>({
    start: async (controller) => {
      const emit = (ev: TurnEvent) => controller.enqueue(ev);
      // Cancellation rides the AbortSignal handed to runner.run() — aborting
      // it makes the SDK iteration below throw, which we map to `cancelled`.
      try {
        for await (const ev of streamed) {
          const mapped = mapEvent(ev as RunStreamEvent, ids);
          if (mapped) emit(mapped);
        }
        await streamed.completed;

        // An aborted run may END GRACEFULLY (the SDK swallows the abort and
        // closes the stream) — cancellation outranks whatever else we saw.
        if (signal.aborted) {
          emit({ ...ids, type: "done", stopReason: "cancelled" });
          resolveOutcome({
            stopReason: "cancelled",
            output: null,
            history: null,
            stateToken: null,
            interruptions: [],
          });
          return;
        }

        const interruptions = streamed.interruptions ?? [];
        if (interruptions.length > 0) {
          const stateToken = streamed.state.toString();
          const pending = interruptions.map((item) => {
            const raw = rawOf(item);
            return {
              id: (typeof raw.callId === "string" ? raw.callId : undefined) ?? (typeof raw.id === "string" ? raw.id : crypto.randomUUID()),
              toolName:
                (item as { toolName?: string }).toolName ??
                (typeof raw.name === "string" ? raw.name : "tool"),
              args: parseArgs(raw.arguments),
            };
          });
          for (const intr of pending) {
            emit({ ...ids, type: "approval.request", interruption: intr, stateToken });
          }
          emit({ ...ids, type: "done", stopReason: "interrupted" });
          resolveOutcome({
            stopReason: "interrupted",
            output: null,
            history: streamed.history as unknown[],
            stateToken,
            interruptions: pending,
          });
        } else {
          emit({ ...ids, type: "done", stopReason: "complete" });
          resolveOutcome({
            stopReason: "complete",
            output: streamed.finalOutput ?? null,
            history: streamed.history as unknown[],
            stateToken: null,
            interruptions: [],
          });
        }
      } catch (err) {
        if (signal.aborted) {
          emit({ ...ids, type: "done", stopReason: "cancelled" });
          resolveOutcome({ stopReason: "cancelled", output: null, history: null, stateToken: null, interruptions: [] });
        } else {
          // Errors are turn CONTENT: the stream reports and terminates cleanly.
          emit({
            ...ids,
            type: "error",
            message: err instanceof Error ? err.message : String(err),
            code: errorCode(err),
          });
          emit({ ...ids, type: "done", stopReason: "error" });
          resolveOutcome({ stopReason: "error", output: null, history: null, stateToken: null, interruptions: [] });
        }
      } finally {
        controller.close();
      }
    },
  });

  return { events, outcome };
}
