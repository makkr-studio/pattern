---
title: What is Pattern
order: 1
---

# Pattern

**A workflow execution engine — and the foundation for a framework.**

Workflows are *data*, not code. Ops carry the code. The engine runs a typed
graph to completion per invocation, with value barriers, concurrent streams,
and dataless control sequencing — all derived from how you wire the ports.

A **workflow** is a JSON document describing a directed graph of typed **ops**
connected by **edges**. The engine runs the subgraph reachable from a trigger
and produces a result. Because workflows are data, they are portable,
inspectable, diffable, versionable — and the basis of the plugin ("mod")
system: the admin you author in, the chat app you talk to, and these very docs
are all mods contributing ops, workflows, and pages to the same engine.

Four defining properties:

1. **Workflows are data, not code.** Just op references + config; the engine never evals anything.
2. **Ops carry the code.** Each node is an instance of an op — typed input/output ports + an `execute`.
3. **The workflow is the unit of isolation.** A whole run can execute off the host loop via a worker pool.
4. **Runtime-neutral core, Node adapter.** Core is plain TypeScript over Web standards; all platform code lives in `@pattern/runtime-node`.

## The central idea: three edge kinds

Edge kind is **derived from port kinds**, never declared separately:

| Edge | From → To | Semantics |
|------|-----------|-----------|
| **Value** | value-out → value-in | **Barrier.** The consumer awaits the produced value. Resolves once per run. |
| **Stream** | stream-out → stream-in | **Concurrent.** Producer and consumer run together; data flows incrementally with backpressure. |
| **Control** | control-out → control-in | **Dataless barrier.** A pure sequencing pulse — order side effects without inventing fake data. |

Every op has an implicit control-in `in` and control-out `out`. Ordinary ops
auto-pulse `out` on completion; control-flow ops (`branch`, `switch`, `gate`, …)
pulse named control-outs instead. Crossing value↔stream is explicit:
`core.stream.accumulate` (stream→value) and `core.stream.emit` (value→stream).

## Hello, Pattern

```ts
import { Engine, type Workflow } from "@pattern/core";

const greeting: Workflow = {
  id: "greeting",
  nodes: [
    { id: "in",    op: "boundary.manual", config: { outputs: ["name"] } },
    { id: "greet", op: "core.string.template", config: { template: "Hello, {{ name }}!" } },
    { id: "out",   op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in",    port: "name" }, to: { node: "greet", port: "data"  } },
    { from: { node: "greet", port: "out"  }, to: { node: "out",   port: "value" } },
  ],
};

const engine = new Engine();           // base op catalog auto-registered
engine.registerWorkflow(greeting);     // validates with human-readable errors

const result = await engine.run(greeting, { input: { name: { name: "world" } } });
console.log(result.outputs);           // { out: { value: "Hello, world!" } }
```

## Where to go next

- [Concepts](concepts.md) — the working mental model: ports, the scheduler, boundaries, hooks, auth, observability.
- [Create an app](guides/creating-an-app.md) — scaffold a project with `npm create pattern`.
- [Projects & mods](guides/projects-and-mods.md) — project anatomy, declarative routes, adding mods.
- [Authoring ops](guides/authoring-ops.md) — write your own ops and bundle them as a mod.
- [Agents & chat](guides/agents-and-chat.md) — the AI stack: agents, tools-as-workflows, the chat app.
- [Extending these docs](guides/extending-the-docs.md) — ship a docs chapter inside your own mod.

These docs are **self-reflecting** where it counts: the op reference and mods
index are generated from the live registry of *this* installation, so what you
read is what is actually running.
