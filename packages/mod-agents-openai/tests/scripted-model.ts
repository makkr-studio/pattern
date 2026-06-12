/**
 * A scripted ModelProvider: each agents.run model call pops the next scripted
 * "model turn" — text (streamed in deltas) or a function call. Tests exercise
 * the full SDK loop (tools, guardrails, interruptions, history) with no API
 * key and no network.
 */

import type { Model, ModelProvider, ModelRequest, ModelResponse } from "@openai/agents";

export type ScriptedTurn =
  | { kind: "text"; text: string; deltas?: string[] }
  | { kind: "tool_call"; name: string; callId: string; args: Record<string, unknown> }
  | { kind: "throw"; message: string }
  | { kind: "hang" };

const usage = { requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function messageItem(text: string) {
  return {
    type: "message" as const,
    role: "assistant" as const,
    status: "completed" as const,
    content: [{ type: "output_text" as const, text }],
  };
}

function functionCallItem(turn: Extract<ScriptedTurn, { kind: "tool_call" }>) {
  return {
    type: "function_call" as const,
    callId: turn.callId,
    name: turn.name,
    status: "completed" as const,
    arguments: JSON.stringify(turn.args),
  };
}

export class ScriptedModel implements Model {
  /** Every ModelRequest the runner made (assert history threading). */
  readonly requests: ModelRequest[] = [];

  constructor(private readonly turns: ScriptedTurn[]) {}

  private next(): ScriptedTurn {
    const turn = this.turns.shift();
    if (!turn) throw new Error("ScriptedModel: script exhausted — unexpected extra model call");
    return turn;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const turn = this.next();
    if (turn.kind === "throw") throw new Error(turn.message);
    const output = turn.kind === "text" ? [messageItem(turn.text)] : [functionCallItem(turn)];
    return { usage: usage as never, output: output as never, responseId: `resp_${this.requests.length}` };
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<never> {
    this.requests.push(request);
    const turn = this.next();
    if (turn.kind === "throw") throw new Error(turn.message);
    yield { type: "response_started" } as never;
    if (turn.kind === "hang") {
      // Park until the run's AbortSignal fires (Stop-button tests).
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (request.signal?.aborted) abort();
        request.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (turn.kind === "text") {
      for (const delta of turn.deltas ?? [turn.text]) {
        yield { type: "output_text_delta", delta } as never;
      }
    }
    const output =
      turn.kind === "text"
        ? [messageItem(turn.text)]
        : turn.kind === "tool_call"
          ? [functionCallItem(turn)]
          : [];
    yield {
      type: "response_done",
      response: { id: `resp_${this.requests.length}`, usage, output },
    } as never;
  }
}

export function scriptedProvider(turns: ScriptedTurn[]): ModelProvider & { model: ScriptedModel } {
  const model = new ScriptedModel(turns);
  return { model, getModel: () => model };
}
