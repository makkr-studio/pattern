/**
 * @pattern/mod-agents — the boundary.tool pair.
 *
 * A tool is a WORKFLOW that starts with `boundary.tool` (name, description,
 * params as JSON Schema — the SchemaBuilder UI in the editor) and ends with
 * `boundary.tool.return`. That one shape buys, for free:
 *
 *  - engine-side argument validation (`validate: true` → TriggerInputError
 *    before the body runs — an LLM's malformed args never reach your graph),
 *  - discovery (the registry scans for these triggers, like hook listeners),
 *  - run linkage (each call is a ctx.invoke sub-run: ↳ links + sampled I/O —
 *    the Runs page is the agent debugger).
 *
 * Guardrails reuse the SAME pair by convention: a guardrail is a tool
 * workflow whose result is `{ tripwire: boolean, info?: unknown }`.
 */

import {
  jsonSchemaToZod,
  required,
  userInputSchema,
  value,
  z,
  type OpDefinition,
  type Ports,
} from "@pattern/core";

const jsonSchema = z.record(z.string(), z.unknown());

export const toolTrigger: OpDefinition = {
  type: "boundary.tool",
  title: "boundary.tool",
  description:
    "Declares this workflow as an agent-callable tool. config: { name, description, params (JSON Schema) }. " +
    "Outputs { args (validated), user }.",
  boundary: "trigger",
  pair: "boundary.tool.return",
  inputs: {},
  // Wire a core.schema.define node into `params` and the resolve phase
  // freezes it — same trick as http.request's body/query/params.
  configInputs: {
    name: value(z.string()),
    description: value(z.string()),
    params: value(jsonSchema),
  },
  outputs: (config: { params?: unknown }): Ports => ({
    args: config.params
      ? value(jsonSchemaToZod(config.params as never), { validate: true })
      : value(z.record(z.string(), z.unknown())),
    user: value(userInputSchema),
  }),
  config: z.object({
    /** Tool name the model sees (unique per app; snake_case reads best). */
    name: z.string().min(1),
    /** What the model reads to decide when to call this tool. */
    description: z.string().optional(),
    /** JSON Schema for the arguments (engine-validated on every call). */
    params: jsonSchema.optional(),
    /** Pause for human approval before each call (HITL). */
    needsApproval: z.boolean().optional(),
  }),
  execute: () => ({}),
};

export const toolReturn: OpDefinition = {
  type: "boundary.tool.return",
  title: "boundary.tool.return",
  description: "Tool out-gate: { result } goes back to the calling agent as the tool's output.",
  boundary: "outgate",
  pair: "boundary.tool",
  reusable: false,
  inputs: { result: required() },
  outputs: {},
  execute: async (ctx) => ({ result: await ctx.input.value("result") }),
};

export const agentBoundaryOps: OpDefinition[] = [toolTrigger, toolReturn];
