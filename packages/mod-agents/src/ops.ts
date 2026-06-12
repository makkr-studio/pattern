/**
 * @pattern/mod-agents — neutral ops (toolset plumbing + guardrail refs).
 *
 * Provider-independent nodes: pick workflow tools into a toolset, merge
 * toolsets from several sources, wrap a tool workflow as a guardrail
 * descriptor. The agent/run ops live in provider mods.
 */

import { value, z, type OpDefinition } from "@pattern/core";
import { agentsService, workflowToolRef } from "./well-known.js";
import { toolsetSchema, type GuardrailDescriptor, type ToolsetDescriptor } from "./types.js";

const toolsWorkflows: OpDefinition = {
  type: "agents.tools.workflows",
  title: "agents.tools.workflows",
  description:
    'Collect boundary.tool workflows into a toolset. config.tools: tool names to include, or empty/["*"] for all.',
  config: z.object({
    /** Tool names to include; empty (or ["*"]) = every discovered tool. */
    tools: z.array(z.string()).default([]),
  }),
  inputs: {},
  outputs: { toolset: value(toolsetSchema) },
  execute: (ctx) => {
    const svc = agentsService(ctx);
    const wanted = (ctx.config as { tools: string[] }).tools.filter((t) => t !== "*");
    const all = svc.listWorkflowTools();
    const picked =
      wanted.length === 0
        ? all
        : wanted.map((name) => {
            const reg = svc.getWorkflowTool(name);
            if (!reg) {
              const known = all.map((t) => t.name).join(", ") || "(none)";
              throw new Error(`agents: no tool workflow named "${name}" — known tools: ${known}`);
            }
            return reg;
          });
    const toolset: ToolsetDescriptor = { kind: "toolset", tools: picked.map(workflowToolRef) };
    return { toolset };
  },
};

const toolsOps: OpDefinition = {
  type: "agents.tools.ops",
  title: "agents.tools.ops",
  description:
    "Collect mod-contributed code tools into a toolset. config.tools: names to include, empty = all registered.",
  config: z.object({ tools: z.array(z.string()).default([]) }),
  inputs: {},
  outputs: { toolset: value(toolsetSchema) },
  execute: (ctx) => {
    const svc = agentsService(ctx);
    const wanted = (ctx.config as { tools: string[] }).tools;
    const all = svc.listOpTools();
    const picked = wanted.length === 0 ? all : all.filter((t) => wanted.includes(t.name));
    const toolset: ToolsetDescriptor = {
      kind: "toolset",
      tools: picked.map((t) => ({ origin: "op", name: t.name, needsApproval: t.needsApproval })),
    };
    return { toolset };
  },
};

const toolsMerge: OpDefinition = {
  type: "agents.tools.merge",
  title: "agents.tools.merge",
  description: "Merge toolsets (workflow tools + MCP servers + op tools) into one. config.count sets the inputs.",
  config: z.object({ count: z.number().int().min(2).max(8).default(2) }),
  inputs: (config: { count?: number }) =>
    Object.fromEntries(
      Array.from({ length: config.count ?? 2 }, (_v, i) => [`tools${i}`, value(toolsetSchema)]),
    ),
  outputs: { toolset: value(toolsetSchema) },
  execute: async (ctx) => {
    const count = (ctx.config as { count: number }).count;
    const sets = await Promise.all(
      Array.from({ length: count }, (_v, i) =>
        ctx.input.has(`tools${i}`) ? ctx.input.value<ToolsetDescriptor>(`tools${i}`) : undefined,
      ),
    );
    const tools = sets.filter(Boolean).flatMap((s) => (s as ToolsetDescriptor).tools);
    // De-dup by identity (a tool picked twice via different routes is once).
    const seen = new Set<string>();
    const deduped = tools.filter((t) => {
      const key = JSON.stringify(t);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { toolset: { kind: "toolset", tools: deduped } satisfies ToolsetDescriptor };
  },
};

const guardrail: OpDefinition = {
  type: "agents.guardrail",
  title: "agents.guardrail",
  description:
    "Wrap a boundary.tool workflow (returning { tripwire, info? }) as an input or output guardrail.",
  config: z.object({
    /** The tool workflow's declared name. */
    tool: z.string().min(1),
    direction: z.enum(["input", "output"]).default("input"),
  }),
  inputs: {},
  outputs: { guardrail: value() },
  execute: (ctx) => {
    const cfg = ctx.config as { tool: string; direction: "input" | "output" };
    const reg = agentsService(ctx).getWorkflowTool(cfg.tool);
    if (!reg) throw new Error(`agents: no tool workflow named "${cfg.tool}" to use as a guardrail`);
    const descriptor: GuardrailDescriptor = {
      kind: "guardrail",
      direction: cfg.direction,
      workflowId: reg.workflowId,
      name: reg.name,
    };
    return { guardrail: descriptor };
  },
};

export const agentsOps: OpDefinition[] = [toolsWorkflows, toolsOps, toolsMerge, guardrail];
