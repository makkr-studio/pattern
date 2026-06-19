---
title: Concepts
order: 3
---

# Concepts

A tour of the model. This is the working mental model with pointers into the code;
for the design rationale and internals see [Architecture](architecture.md).

## Vocabulary

| Term | Meaning |
|------|---------|
| **Op** | A reusable definition: a type id, typed input/output ports, a config schema, an `execute`. Lives in the registry. |
| **Node** | An instance of an op placed in a workflow, with its own id and config. May carry a `title` (short label) and a `comment` (free-form note) — data-only annotations for self-documenting, educational workflows; shown by `pattern graph`. |
| **Port** | A typed slot — **value**, **stream**, or **control**. |
| **Edge** | A connection from one node's output port to another's input port. |
| **Workflow** | A JSON document: nodes + edges. |
| **Boundary** | A special op connecting the graph to the outside world — usually a **trigger** + **out-gate** pair. |
| **Run** | One execution, started by exactly one trigger firing, under one **Principal**. |
| **Hook** | A named, priority-ordered, payload-threading filter chain of workflows. |
| **Event** | A named fire-and-forget pub/sub signal. |

## Ports and the three edge kinds

A port is `value`, `stream`, or `control`. **Edge kind is derived from the ports
it connects** — you never declare it:

- **Value edge** (value→value): a *barrier*. The consumer awaits the produced value.
- **Stream edge** (stream→stream): *concurrent*. Producer and consumer run together; data flows incrementally with backpressure until the stream closes.
- **Control edge** (control→control): a *dataless barrier* — a sequencing pulse.

A port may only connect to a port of the **same kind**. To cross value↔stream you
insert an explicit adapter op: `core.stream.accumulate` (stream→value, a barrier)
or `core.stream.emit` (value→stream). `z.any()` ports bypass strict schema
checking — the escape hatch.

### Control ports

Every op implicitly exposes one control-in `in` and one control-out `out`; wiring
them is optional. For ordinary ops, `out` pulses automatically the moment the op
completes. Control-flow ops (`core.flow.branch`, `core.flow.switch`, …) declare
**named** control-outs (`then`/`else`, `case.0`…) and pulse them *selectively*
instead of the automatic `out`. A node with wired control-ins waits for **all** of
them (AND semantics) before it starts.

> A **declared** data port named `in`/`out` shadows the implicit control port —
> that's why stream ops can legitimately call their data ports `in`/`out`
> (`core.stream.split` → `out.0..n`). See `portKindOf` in
> `core/src/graph.ts`.

## The scheduler

`core/src/scheduler/run.ts` launches every node of
the reachable subgraph concurrently. Each node blocks on its own value inputs
(promise barriers) and control-in pulses (dataless barriers); stream inputs are
handed over immediately so streaming nodes start producing right away. **No
topological sort** is needed — ordering falls out of the deferreds.

- **Value slot** — a `Deferred` that resolves once.
- **Stream hub** — a backpressured broadcaster that tees one output to N consumers (high-water mark 1 per consumer, so a slow branch slows the source rather than buffering unboundedly).
- **Pulse** — a `Deferred<"pulse" | "skip">` per control-out.

When a control-flow op pulses one control-out, the engine marks the *others* as
**skip**, and skip propagates forward through control, value, and stream edges so
the unreached region settles instead of hanging. A value input with several
producers (branch convergence) resolves to whichever producer actually fires.

A run is **result-ready** once its reachable out-gates have captured their
results. For a streaming out-gate (SSE/chunked) the captured value is a *live*
stream the host consumes afterward — so the engine must not wait for it to drain
(that would deadlock). Workflows with no out-gate (event subscribers) wait for
every node instead.

## Boundaries

Boundaries connect the graph to the outside world. A **trigger** has no graph
inputs — its outputs are the external input, seeded by the host (so a trigger's
`execute` is never called). An **out-gate** has no graph outputs — its resolved
inputs *are* the external payload the host writes. One run = one trigger; the
engine executes only that trigger's reachable subgraph, so other triggers stay
dormant.

The boundary **contracts** live in core (`core/src/boundaries/`);
the **hosts** that bind them (HTTP, WebSocket, CLI, schedule) live in
`@pattern/runtime-node`. This keeps core
runtime-neutral and serves distribution.

Boundary configuration is **declarative** — e.g. an HTTP route's method, path,
port, CORS, and body/query JSON-Schema all live in the `boundary.http.request`
node's config, and the host derives its routes by scanning registered workflows
(no programmatic route table). Workflows are modifiable at runtime and the host
re-derives live. See [Projects & mods](guides/projects-and-mods.md).

## Hooks vs events

Two distinct extensibility primitives — keep both:

- **Event** = pub/sub, async, unordered, no return (`core.event.emit`, `boundary.event`).
- **Hook** = a synchronous, priority-ordered filter chain that threads a payload through every registered workflow and returns the result (`core.hook.invoke`, `boundary.hook`). Fail-fast, short-circuitable (`stop: true`), Zod-typed payloads, recursion-guarded. The extensibility backbone where mods splice into lifecycle points.

## Auth & identity

Auth is run context, not a boundary: every entry point wants to know "who is this
running as." `ctx.principal` is first-class, defaulting to anonymous. Providers
form a registry chain; triggers may declare `requireAuth`, enforced by the host
*before* the graph runs. User storage is a mod concern — core defines only
`Principal` and `AuthProvider`.

## Observability

One trace per run, one span per node, OTLP-*shaped* but zero-dependency. The
engine **emits** to a subscribable `TraceSink` and stores nothing. Subscribe with
`engine.onTrace(sink)`; `@pattern/runtime-node` ships JSONL and SQLite sinks.

## Distribution (invariant, not a v1 feature)

Nothing may preclude distribution: workflow definitions, trigger inputs, run
context, and hook payloads are serializable; dispatch goes through `RunTransport`
(in-process or worker pool now, queue + remote workers later); the bus, hook
registry, and connection registry all sit behind interfaces. No shared mutable
memory across runs; ops reach the outside only through capabilities in `ctx`.
