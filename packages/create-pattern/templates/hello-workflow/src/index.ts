/**
 * hello-workflow — the smallest possible Pattern program.
 *
 * A workflow is JSON: a graph of typed *ops* connected by *edges*. The engine
 * runs the subgraph reachable from a trigger and returns the out-gate's result.
 *
 * Here: a `boundary.manual` trigger feeds a name into a `core.string.template`
 * op, whose output flows to a `boundary.return` out-gate.
 */
import { Engine, type Workflow } from "@pattern/core";

const greeting: Workflow = {
  id: "greeting",
  name: "Hello, Pattern",
  nodes: [
    // A trigger has no graph inputs — its outputs ARE the external input.
    { id: "in", op: "boundary.manual", config: { outputs: ["name"] } },
    // Ops carry the code; the workflow only references them by type + config.
    { id: "greet", op: "core.string.template", config: { template: "Hello, {{ name }}! 👋" } },
    // An out-gate consumes graph outputs and produces the external result.
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    // A value edge is a barrier: `greet` waits for the value, computes, emits.
    { from: { node: "in", port: "name" }, to: { node: "greet", port: "data" } },
    { from: { node: "greet", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

const engine = new Engine();
engine.registerWorkflow(greeting);

const result = await engine.run(greeting, { input: { name: { name: "world" } } });
console.log(result.outputs); // { out: { value: "Hello, world! 👋" } }
