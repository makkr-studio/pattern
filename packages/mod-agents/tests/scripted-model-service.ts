/**
 * A scripted AiModelService: each streamTurn pops the next scripted "model
 * turn" — text (streamed in deltas) or a tool call. Tests exercise the full
 * native loop (tools, guardrails, HITL, history) with no provider and no network.
 */

import type {
  AiModelService,
  GenerateTextInput,
  NeutralChunk,
  StreamTurnInput,
} from "@pattern-js/mod-agents";

export type ScriptedTurn =
  | { kind: "text"; text: string; deltas?: string[] }
  | { kind: "tool_call"; name: string; callId: string; args: Record<string, unknown> }
  | { kind: "throw"; message: string }
  | { kind: "hang" };

export function scriptedModelService(turns: ScriptedTurn[]): AiModelService & { calls: StreamTurnInput[] } {
  const calls: StreamTurnInput[] = [];
  const queue = [...turns];

  return {
    calls,
    async *streamTurn(input: StreamTurnInput): AsyncIterable<NeutralChunk> {
      calls.push(input);
      const turn = queue.shift();
      if (!turn) throw new Error("scriptedModelService: script exhausted — unexpected extra model call");
      if (turn.kind === "throw") throw new Error(turn.message);
      if (turn.kind === "hang") {
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          if (input.signal.aborted) abort();
          input.signal.addEventListener("abort", abort, { once: true });
        });
        return;
      }
      if (turn.kind === "text") {
        for (const delta of turn.deltas ?? [turn.text]) yield { type: "text-delta", delta };
        yield { type: "finish", finishReason: "stop", message: { role: "assistant", content: turn.text } };
        return;
      }
      // tool_call
      yield { type: "tool-call", callId: turn.callId, toolName: turn.name, args: turn.args };
      yield {
        type: "finish",
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: turn.callId, toolName: turn.name, args: turn.args }],
        },
      };
    },
    async generateText(input: GenerateTextInput) {
      calls.push(input as StreamTurnInput);
      const turn = queue.shift();
      if (!turn || turn.kind !== "text") throw new Error("scriptedModelService: expected a text turn for generateText");
      return { text: turn.text };
    },
  };
}
