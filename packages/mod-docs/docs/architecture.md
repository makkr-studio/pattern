---
title: Architecture
order: 4
---

# Architecture

The durable "why" behind the engine: the design decisions that shape everything
else. [Concepts](concepts.md) is the working vocabulary; this is the rationale and
the internals. For the live op list see the [op reference](/ops); for the
exact mechanics, the cited source files are the source of truth.

## Four defining properties

1. **Workflows are data.** A workflow is a JSON document describing a
   directed graph of nodes and edges. It contains no executable code: only
   references to op *types* and their config. The engine never `eval`s anything in
   the JSON. This is what makes workflows portable, inspectable, diffable,
   versionable, and editable in the admin. It is also the basis of the mod system.
2. **Ops carry the code.** Each node is an instance of an *op*: a reusable unit
   with typed input/output ports and an `execute` function, living in a registry
   keyed by a stable `type` id. Op type ids are a public contract: treat them like
   API.
3. **The workflow is the unit of isolation.** A run can execute off the host's
   main loop via a `node:worker_threads` pool, so one run can't block the host and
   runs can be distributed. Individual ops are *not* independently isolated: the
   unit of parallelism is the whole workflow.
4. **Runtime-neutral core, thin Node adapter.** `@pattern-js/core` is plain
   TypeScript over Web-standard APIs only (Web Streams, `AbortController`,
   `fetch`/`Request`/`Response`, `crypto.subtle`), with no platform code. The narrow
   runtime surface (HTTP/WS server, worker spawning, sqlite, the filesystem) lives
   behind `@pattern-js/runtime-node`. Keeping the core neutral means platform code has
   exactly one home, and an alternate adapter drops in cleanly without forking the core.

### Execution model

The baseline is a **stateless DAG**: each invocation runs the reachable subgraph
once and produces a result. Ports may be **streams**, enabling a dataflow style
where data moves incrementally with backpressure. Streaming is opt-in and mixes
freely with value ports.

## The three edge kinds

Edge kind is **derived from the ports it connects**, and it is the
central scheduling rule:

- **Value edge** (value→value), a **barrier**: the consumer awaits the produced
  value. Resolves once per run.
- **Stream edge** (stream→stream), **concurrent**: producer and consumer run
  together, data flowing with backpressure until the stream closes.
- **Control edge** (control→control), a **dataless barrier**, a pure sequencing
  pulse. This is how you order side-effecting nodes ("log, *then* send, *then*
  respond") without inventing fake data dependencies.

A port only connects to a port of the **same kind**. Crossing value↔stream takes
an explicit adapter op: `core.stream.accumulate` (stream→value, a barrier) or
`core.stream.emit` (value→stream). `z.any()` ports are the escape hatch and bypass
strict schema checking.

**Control ports.** Every op implicitly exposes one control-in (`in`) and one
control-out (`out`); wiring them is optional. Ordinary ops auto-pulse `out` the
moment they complete. Control-flow ops (`core.flow.branch`, `core.flow.switch`, …)
declare *named* control-outs and pulse them selectively. A node with wired
control-ins waits for **all** of them (AND semantics). A *declared* data port named
`in`/`out` shadows the implicit control port. That is why stream ops legitimately
name their data ports `in`/`out` (`portKindOf` in `core/src/graph.ts`).

## The scheduler

`core/src/scheduler/run.ts` is the heart. It launches every node of the reachable
subgraph **concurrently**; each node blocks on its own value inputs (promise
barriers) and control-in pulses (dataless barriers), while stream inputs are handed
over immediately so streaming nodes start producing right away. **No topological
sort is needed**; ordering falls out of the deferreds. Topology is computed at
validation time only, for cycle detection and reachability.

The primitives:

- **Value slot**: a `Deferred` that resolves once.
- **Stream hub**: a backpressured broadcaster that tees one output to N consumers
  (high-water mark 1 per consumer, so a slow branch applies backpressure to the
  source and nothing buffers unboundedly).
- **Pulse**: a `Deferred<"pulse" | "skip">` per control-out.

When a control-flow op pulses one control-out, the engine marks the others
**skip**, and skip propagates forward through control, value, and stream edges so
unreached regions settle cleanly. A value input with several producers
(branch convergence) resolves to whichever producer actually fires.

A run is **result-ready** once its reachable out-gates have captured their results.
For a *streaming* out-gate (SSE/chunked) the captured value is a live stream the
host consumes afterward, so the engine must not wait for it to drain (that would
deadlock). Workflows with no out-gate (event subscribers) wait for every node.
On any node error or external cancellation the run aborts fast: the signal
fires, streams cancel, pending deferreds and pulses reject.

## Boundaries

Boundaries connect the graph to the outside world, usually as a matched **trigger**
+ **out-gate** pair. A trigger has no graph inputs: its outputs *are* the external
input, seeded by the host (so a trigger's `execute` is never called). An out-gate
has no graph outputs: its resolved inputs *are* the external payload the host
writes. Out-gates are where an in-process stream becomes an external wire format
(SSE, chunked HTTP).

The boundary **contracts and payload schemas live in core**
(`core/src/boundaries/`); the **hosts** that bind an external source to a trigger
and write the out-gate result live in `@pattern-js/runtime-node` (HTTP, WebSocket,
CLI, schedule). Boundary configuration is **declarative**: an HTTP route's method,
path, port, CORS, and body/query JSON-Schema all live in the
`boundary.http.request` node's config, and the host derives its route table by
*scanning registered workflows*; there is no programmatic route table. Workflows
are modifiable at runtime and the host re-derives live. A workflow may hold several
triggers; one run is started by exactly one trigger firing, executing only that
trigger's reachable subgraph.

## Hooks and events

Two distinct extensibility primitives, both kept:

- **Event**: fire-and-forget pub/sub, async, unordered, no return value
  (`core.event.emit`, `boundary.event`).
- **Hook**: a synchronous, priority-ordered **filter chain** that threads a
  payload through every registered workflow and returns the result
  (`core.hook.invoke`, `boundary.hook`). Ascending priority (lower first, default
  100); fail-fast; short-circuitable with `stop: true`; Zod-typed payloads;
  recursion-guarded. Hooks are the backbone where mods splice into lifecycle points
  to validate or enrich data.

## Auth & identity

Auth belongs to the **run context**, separate from the boundary layer: every entry
point wants to know "who is this running as." `ctx.principal` is first-class,
defaulting to anonymous. Auth providers form a registry **chain**; a trigger may
declare `requireAuth` (a boolean or `{ scopes }`), enforced by the host *before*
the graph runs. A required-but-anonymous request returns the boundary's
unauthorized form (HTTP 401, CLI nonzero exit) without executing the graph. Auth
*flows* are ordinary workflows (an OAuth callback is an HTTP trigger + provider
ops). **User storage is a mod concern**: core defines only `Principal` and
`AuthProvider`, which keeps every auth paradigm open
(see [`@pattern-js/mod-identity`](/identity)).

## Observability

One trace per run, one span per node: OTLP-*shaped* but zero-dependency (core
ships its own span types and pulls in no OpenTelemetry SDK). The engine **emits** to a
subscribable `TraceSink` and stores nothing itself; subscribe with
`engine.onTrace(sink)`. `@pattern-js/runtime-node` ships sinks that persist when you
want it (JSONL and a SQLite `TraceStore`), so the admin's run inspector and replay
have durable history, while the core stays emit-don't-persist. Opt-in span I/O
sampling (capped, secret-masked) powers the run-replay data peeks.

## Distribution: an invariant

Multi-machine execution isn't built, but nothing may preclude it. The invariants
hold from day one:

- **Serializability**: workflow definitions, trigger inputs, run context
  (including `Principal`), and hook payloads are all serializable. Non-serializable
  handles (raw sockets) stay host-side; only their data crosses.
- **Dispatch behind a transport**: runs dispatch through a `RunTransport`
  interface (in-process for dev, a `node:worker_threads` pool for isolation; a
  queue + remote workers later). The scheduler doesn't know which.
- **Bus, registries, connection table behind interfaces**, so they can become
  network-backed without touching any workflow.
- **No shared mutable memory** across runs; ops reach the outside only through the
  capabilities handed in via `ctx`.

## Package map

The bulk lives in `@pattern-js/core`; everything else is a thin adapter or an optional
mod you `engine.use()`.

| Package | Role |
|---------|------|
| `@pattern-js/core` | Runtime-neutral engine: types, validation, scheduler, streams, the base op catalog, boundaries, hooks/events, auth, observability. One dependency: Zod. |
| `@pattern-js/runtime-node` | The Node adapter: HTTP/WS/CLI/schedule hosts, the worker pool, the filesystem, trace sinks, `loadProject`, the `pattern` CLI. |
| `@pattern-js/admin-sdk` | The stable extension surface mod UIs import (typed client, UI kit, menu/page/command helpers). |
| `@pattern-js/mod-admin` | The self-reflecting control surface at `/admin`; see its [internals](/admin). |
| `@pattern-js/mod-docs` | These docs: a served handbook + the generated op reference + `/docs/llms.txt`. |
| `@pattern-js/mod-identity`, `@pattern-js/mod-auth-magic-link` | Identity kernel + a reference login method. |
| `@pattern-js/mod-store`, `@pattern-js/mod-vault` | Persistence (documents/blobs/leases) + encrypted secrets. |
| `@pattern-js/mod-agents`, `@pattern-js/mod-ai` | Neutral agent contracts + native run loop, and the AI capability layer (the model provider, text/image/embed/STT/TTS/video ops, MCP). |
| `@pattern-js/mod-chat` | The chat application. |
| `@pattern-js/mod-sample` | The anatomy-of-a-mod reference (ops + routes + a Tier-1 *and* Tier-2 admin page). |
| `@pattern-js/create-pattern` | The scaffolder CLI (`npm create pattern`). |

## Decisions of record

1. **Zod, pervasively**: ports, config, the workflow doc, boundary + hook
   payloads. The one sanctioned core dependency; gives runtime validation plus
   end-to-end TypeScript inference, and human-readable errors that name the
   offending node/port.
2. **Runtime-neutral core; thin Node adapter**: platform code has exactly one home.
3. **Three edge kinds, derived from port kind**: value (barrier+data), stream
   (concurrent), control (dataless pulse); value↔stream bridged by explicit adapter
   ops.
4. **One run = one trigger**, executing only that trigger's reachable subgraph.
5. **Auth lives in run context, outside the boundary layer**: `Principal` + provider
   chain + optional per-trigger requirement; user storage is a mod concern.
6. **Hooks vs events kept distinct**: ordered filter chain vs fire-and-forget.
7. **Observability is OTLP-shaped and zero-dep**: emit from core; persist in the
   adapter's sinks.
8. **Distribution is an invariant**: serializable state; transport, bus, and
   registries behind interfaces.
9. **Cycles are forbidden**: the graph is a DAG, checked at validation time.
