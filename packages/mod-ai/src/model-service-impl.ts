/**
 * @pattern-js/mod-ai — implements the neutral AiModelService for the agent loop.
 *
 * One `streamTurn` = ONE model step over the AI SDK (`stepCountIs(1)`); the loop
 * (in mod-agents) owns multi-step. Tools are passed WITHOUT an execute function
 * so the SDK forwards every call back to the loop, which dispatches them as
 * Pattern sub-runs. Maps SDK stream parts → neutral chunks.
 */

import type {
  AiModelService,
  GenerateTextInput,
  ModelRef,
  NeutralChunk,
  NeutralToolDef,
  StreamTurnInput,
  Usage,
} from "@pattern-js/mod-agents";
import type { OpContext } from "@pattern-js/core";
import { generateText, jsonSchema, stepCountIs, streamText, tool, type ToolSet } from "./sdk.js";
import type { AiProviderService } from "./provider.js";
import { toModelMessages } from "./messages.js";
import { mapUsage } from "./ops/shared.js";

function buildTools(defs: NeutralToolDef[] | undefined): ToolSet | undefined {
  if (!defs?.length) return undefined;
  const set: ToolSet = {};
  for (const d of defs) {
    // No `execute`: the SDK forwards the call to us; the loop runs the sub-run.
    set[d.name] = tool({
      description: d.description ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema((d.parameters ?? { type: "object", properties: {} }) as any),
    });
  }
  return set;
}

export class ModelServiceImpl implements AiModelService {
  constructor(
    private readonly provider: AiProviderService,
    private readonly defaultModel: () => ModelRef | undefined = () => undefined,
  ) {}

  private async languageModel(modelRef: ModelRef | undefined, ctx: OpContext) {
    const ref = modelRef ?? this.defaultModel();
    if (!ref) {
      throw new Error(
        "mod-ai: no model specified and no default configured — wire an ai.model node, or set a default in admin → Settings → AI Providers.",
      );
    }
    return this.provider.languageModel(ref, ctx);
  }

  async *streamTurn(input: StreamTurnInput): AsyncIterable<NeutralChunk> {
    const model = await this.languageModel(input.modelRef, input.ctx);
    const messages = await toModelMessages(input.messages, input.ctx);
    const result = streamText({
      model,
      system: input.system,
      messages,
      tools: buildTools(input.tools),
      stopWhen: stepCountIs(1),
      abortSignal: input.signal,
    });

    let text = "";
    for await (const delta of result.textStream) {
      text += delta;
      yield { type: "text-delta", delta };
    }
    const toolCalls = await result.toolCalls;
    const calls = toolCalls.map((tc) => ({ callId: tc.toolCallId, toolName: tc.toolName, args: tc.input as unknown }));
    for (const c of calls) yield { type: "tool-call", callId: c.callId, toolName: c.toolName, args: c.args };

    yield {
      type: "finish",
      finishReason: await result.finishReason,
      usage: mapUsage(await result.totalUsage),
      message: { role: "assistant", content: text, toolCalls: calls.length ? calls : undefined },
    };
  }

  async generateText(input: GenerateTextInput): Promise<{ text: string; usage?: Usage }> {
    const model = await this.languageModel(input.modelRef, input.ctx);
    const messages = await toModelMessages(input.messages, input.ctx);
    const r = await generateText({ model, system: input.system, messages });
    return { text: r.text, usage: mapUsage(r.usage) };
  }
}
