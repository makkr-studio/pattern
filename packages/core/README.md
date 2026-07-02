# @pattern-js/core

The runtime-neutral [Pattern](../../README.md) execution engine. Plain TypeScript
over Web standards (Web Streams, `AbortController`, `fetch`, `crypto.subtle`).
One dependency: **Zod**.

[pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/core)

```bash
npm install @pattern-js/core
```

```ts
import { Engine, type Workflow } from "@pattern-js/core";

const engine = new Engine();              // base op catalog auto-registered
engine.registerWorkflow(wf);              // validates with human-readable errors
const result = await engine.run(wf, { input: { /* trigger ports */ } });
```

## What's inside

- **Types & contracts**: `PortSpec`, `OpDefinition`, `Workflow`, `Principal`, hook/event/observability interfaces.
- **Validation**: load-time checks (op/port existence, edge kind & schema compatibility, cycles, boundary pairing) with located, human-readable errors.
- **Scheduler**: value barriers + control pulses + backpressured stream fan-out; skip propagation for branches; sub-workflow invocation.
- **Op catalog**: constants, scalars, strings, objects, arrays (+ higher-order), control flow, data/encoding, time, crypto, `http.fetch`, the stream ops, WebSocket ops, hooks/events. Browse the generated reference at `/docs/ops`.
- **Boundaries**: contracts + payload schemas (HTTP, WS, CLI, manual, schedule, hook, event).
- **Hooks & events**, **auth** (Principal + provider chain), **observability** (OTLP-shaped spans), **transport** (in-process; pluggable).

Subpath exports: `@pattern-js/core` (everything), `@pattern-js/core/ops`, `@pattern-js/core/boundaries`.

## Key APIs

| | |
|---|---|
| `new Engine(opts?)` | the façade: registries, services, transport, trace fan-out |
| `engine.registerWorkflow(wf)` | validate + register (auto-wires `boundary.hook` / `boundary.event`) |
| `await engine.registerWorkflowAsync(wf)` | same, but runs the resolve phase for boundary config ports |
| `engine.run(wf, { trigger?, input?, params?, principal? })` | run; returns `RunResult` |
| `engine.registerOp(op)` / `engine.use(mod)` | extend with ops / a plugin mod |
| `engine.onTrace(sink)` | subscribe to telemetry |
| `engine.invokeHook(name, payload)` / `engine.emit(event, payload)` | extensibility |
| `validateWorkflow(doc, ops)` / `formatGraph(wf, ops)` | validate / render |

See [authoring ops](../mod-docs/docs/guides/authoring-ops.md), [concepts](../mod-docs/docs/concepts.md), and [architecture](../mod-docs/docs/architecture.md).
