/**
 * @pattern-js/mod-agents-openai — descriptor → SDK reification.
 *
 * Descriptors are plain JSON on edges; SDK objects exist only inside an
 * executing node. Reification wires each origin to its execution path:
 *
 *  - workflow tools → `ctx.invoke` — every call is a LINKED SUB-RUN (↳ in the
 *    Runs page, engine-validated args, sampled I/O),
 *  - op tools → the AGENTS_SERVICE registry (mods contribute in setup),
 *  - mcp refs → pooled long-lived servers on `agent.mcpServers`,
 *  - guardrails → tool workflows returning { tripwire, info? },
 *  - handoffs → recursively reified agents.
 *
 * Tool params stay JSON Schema end-to-end (`strict: false` — OUR engine is
 * the validator, at the boundary.tool trigger).
 */

import { Agent, tool, type InputGuardrail, type MCPServer, type OutputGuardrail, type Tool } from "@openai/agents";
import type { OpContext } from "@pattern-js/core";
import {
  agentsService,
  type AgentDescriptor,
  type GuardrailDescriptor,
  type ToolRef,
  type ToolsetDescriptor,
} from "@pattern-js/mod-agents";
import { mcpServerFor } from "./pool.js";

/**
 * Normalize a JSON Schema into the NON-STRICT object shape tool() accepts
 * (additionalProperties: true is the literal the type requires). Non-strict
 * is deliberate: OUR engine validates the declared schema at the
 * boundary.tool trigger — the authoritative check, not the model's.
 */
function paramsSchema(params?: Record<string, unknown>): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: true;
} {
  const p = params ?? {};
  return {
    type: "object",
    properties: (p.properties as Record<string, Record<string, unknown>>) ?? {},
    required: Array.isArray(p.required) ? (p.required as string[]) : [],
    additionalProperties: true,
  };
}

function workflowTool(ref: Extract<ToolRef, { origin: "workflow" }>, ctx: OpContext): Tool {
  return tool({
    name: ref.name,
    description: ref.description ?? "",
    parameters: paramsSchema(ref.params),
    strict: false,
    needsApproval: ref.needsApproval ?? false,
    execute: async (input) => {
      const args = (input ?? {}) as Record<string, unknown>;
      ctx.trace.addEvent("tool.call", { tool: ref.name, workflowId: ref.workflowId });
      // The linked sub-run: engine-validated args, ↳ linkage, sampled I/O.
      const outputs = await ctx.invoke({ workflowId: ref.workflowId }, { args });
      return outputs.result === undefined ? outputs : outputs.result;
    },
  });
}

function opTool(ref: Extract<ToolRef, { origin: "op" }>, ctx: OpContext): Tool {
  const reg = agentsService(ctx).getOpTool(ref.name);
  if (!reg) {
    throw new Error(`agents: no registered op tool named "${ref.name}" (mods register them in setup)`);
  }
  return tool({
    name: reg.name,
    description: reg.description,
    parameters: paramsSchema(reg.params),
    strict: false,
    needsApproval: ref.needsApproval ?? reg.needsApproval ?? false,
    execute: (input) => reg.execute((input ?? {}) as Record<string, unknown>, ctx),
  });
}

export async function reifyToolset(
  toolset: ToolsetDescriptor | undefined,
  ctx: OpContext,
): Promise<{ tools: Tool[]; mcpServers: MCPServer[] }> {
  const tools: Tool[] = [];
  const mcpServers: MCPServer[] = [];
  for (const ref of toolset?.tools ?? []) {
    if (ref.origin === "workflow") tools.push(workflowTool(ref, ctx));
    else if (ref.origin === "op") tools.push(opTool(ref, ctx));
    else mcpServers.push(await mcpServerFor(ref));
  }
  return { tools, mcpServers };
}

/** Extract plain text from a guardrail's input/output payloads. */
function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        const it = item as { content?: unknown; text?: unknown };
        if (typeof it.text === "string") return it.text;
        if (typeof it.content === "string") return it.content;
        if (Array.isArray(it.content)) {
          return it.content
            .map((c) => (typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
            .join("");
        }
        return "";
      })
      .join("\n");
  }
  return JSON.stringify(v ?? "");
}

/**
 * A guardrail is a tool WORKFLOW returning { tripwire: boolean, info? } —
 * its run is linked + sampled like any tool call.
 */
function reifyGuardrail(desc: GuardrailDescriptor, ctx: OpContext): InputGuardrail & OutputGuardrail {
  const execute = async (args: Record<string, unknown>) => {
    const text = textOf("input" in args ? args.input : args.agentOutput);
    const outputs = await ctx.invoke(
      { workflowId: desc.workflowId },
      { args: { input: text, direction: desc.direction } },
    );
    const result = (outputs.result ?? outputs) as { tripwire?: unknown; info?: unknown };
    return { tripwireTriggered: Boolean(result.tripwire), outputInfo: result.info };
  };
  return { name: desc.name, execute } as unknown as InputGuardrail & OutputGuardrail;
}

export interface ReifiedAgent {
  agent: Agent;
}

export async function reifyAgent(desc: AgentDescriptor, ctx: OpContext): Promise<Agent> {
  const { tools, mcpServers } = await reifyToolset(desc.tools, ctx);
  const handoffs: Agent[] = [];
  for (const h of desc.handoffs ?? []) handoffs.push(await reifyAgent(h, ctx));
  const guardrails = desc.guardrails ?? [];
  return new Agent({
    name: desc.name,
    instructions: desc.instructions,
    ...(desc.model ? { model: desc.model } : {}),
    ...(desc.modelSettings ? { modelSettings: desc.modelSettings as never } : {}),
    ...(desc.handoffDescription ? { handoffDescription: desc.handoffDescription } : {}),
    tools,
    mcpServers,
    handoffs,
    inputGuardrails: guardrails.filter((g) => g.direction === "input").map((g) => reifyGuardrail(g, ctx)),
    outputGuardrails: guardrails.filter((g) => g.direction === "output").map((g) => reifyGuardrail(g, ctx)),
  });
}
