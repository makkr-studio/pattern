<div align="center">

# Pattern

**A workflow execution engine — and the foundation for a framework.**

Workflows are *data*, not code. Ops carry the code. The engine runs a typed
graph to completion per invocation, with value barriers, concurrent streams, and
dataless control sequencing — all derived from how you wire the ports.

</div>

---

## What it is

A **workflow** is a JSON document describing a directed graph of typed **ops**
connected by **edges**. The engine runs the subgraph reachable from a trigger and
produces a result. Because workflows are data, they are portable, inspectable,
diffable, versionable — and the basis of the plugin (“mod”) system.

```
request → agent(tokens: stream) → split(2) ─┬─▶ SSE response body
                                             └─▶ TTS synthesis
```

Four defining properties (see [the spec](./pattern-engine-spec.md)):

1. **Workflows are data, not code.** Just op references + config; the engine never `eval`s.
2. **Ops carry the code.** Each node is an instance of an op — typed input/output ports + an `execute`.
3. **The workflow is the unit of isolation.** A whole run can execute off the host loop via a worker pool.
4. **Runtime-neutral core, Node adapter.** Core is plain TypeScript over Web standards; all platform code lives in `@pattern/runtime-node`.

## Quickstart

```bash
npm create pattern@latest          # scaffold a project (interactive)
# or: pnpm create pattern my-app --template agent-sse-tts
```

Run the streaming example straight from this repo:

```bash
pnpm install && pnpm build
pnpm --filter example-agent-sse-tts dev          # serves SSE on :3000
curl -N "http://localhost:3000/chat?q=hello"     # watch tokens stream in
```

Or use the engine directly:

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
console.log(result.outputs);            // { out: { value: "Hello, world!" } }
```

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

> The scheduler needs **no topological sort**: value ordering falls out of promise
> deferreds, control ordering out of dataless pulses, stream fan-out out of a
> backpressured hub. A branch not taken propagates a *skip* through the unreached
> subgraph so it settles cleanly instead of hanging.

## Packages

| Package | What |
|---------|------|
| [`@pattern/core`](./packages/core) | The runtime-neutral engine: types, validation, scheduler, streams, the [op catalog](./docs/op-catalog.md), hooks/events, auth, observability. One dependency: Zod. |
| [`@pattern/runtime-node`](./packages/runtime-node) | Node adapter: HTTP/WebSocket/CLI/schedule hosts, `node:worker_threads` pool transport, socket-bound connection registry, JSONL/SQLite trace sinks, the `pattern` CLI. |
| [`create-pattern`](./packages/create-pattern) | The scaffolder (`npm create pattern`). Dev-time only, so it’s rich: prompts, banner, templates. |

## Docs

- [Concepts](./docs/concepts.md) — ports, edges, the scheduler, boundaries, hooks vs events, auth.
- [Op catalog](./docs/op-catalog.md) — every base op, grouped, with ports & config.
- [Authoring ops & mods](./docs/authoring-ops.md) — write your own ops, boundaries, and plugins.
- [The spec](./pattern-engine-spec.md) — the full design of record.

## CLI

```bash
pattern graph workflow.json      # render a workflow's graph in the terminal
pattern validate workflow.json   # validate, with located, human-readable errors
pattern dev [entry]              # run an entry with file-watch hot-reload
```

## Develop

```bash
pnpm install
pnpm build         # build all packages
pnpm test          # 44 tests across scheduler, streams, boundaries, hooks, auth, workers
pnpm typecheck
```

## Status

v1 of the **execution engine**, its **Node adapter**, and the **scaffolder** — the
whole spec implemented. Designed-for-but-not-built (no architectural blockers):
durable/resumable runs, distributed execution behind the same `RunTransport`, and
the admin-UI mod. See [§13 of the spec](./pattern-engine-spec.md).

## License

MIT
