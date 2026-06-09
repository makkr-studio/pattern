# Pattern — Execution Engine Specification

**Status:** Design, ready for implementation.
**Runtime:** **Node.** The core is runtime-neutral (Web standards), so the single runtime adapter is written against Node's APIs. Bun-native optimizations may be evaluated after v1.
**Scope:** the core execution engine, its runtime adapters, and the scaffolding CLI. The admin UI (a future "mod") is out of scope.

---

## 1. What Pattern is

Pattern is a **workflow execution engine** and the foundation for a framework. A workflow is a declarative graph of typed operations the engine runs to completion per invocation. It is intended as a building foundation for (mostly web-oriented) projects, with developer adoption, extensibility, and a path to scale as primary concerns.

Defining properties:

1. **Workflows are data, not code.** A workflow is a JSON document describing a directed graph of nodes and edges. It contains no executable code — only references to op types and their configuration. This makes workflows portable, inspectable, diffable, versionable, and is the basis of the plugin ("mod") system.
2. **Ops carry the code.** Each node is an instance of an *op* — a reusable unit with typed input/output ports and an execute function. Implementations live in a registry keyed by a type id. The engine never `eval`s code embedded in workflow JSON.
3. **Workflows are the unit of isolation.** A whole workflow run executes outside the host's main event loop via a worker pool (`node:worker_threads`), so a run cannot block the host and runs can be distributed. Individual ops are **not** independently isolated — the unit of parallelism is the workflow.
4. **Runtime-neutral core, Node adapter.** The engine is plain TypeScript over Web-standard APIs (Web Streams, `AbortController`, `fetch`/`Request`/`Response`, `crypto.subtle`) and contains no runtime-specific code. The narrow runtime surface — HTTP server, worker spawning, optional sqlite — lives behind a thin adapter written against Node (`node:http`, `node:worker_threads`). Keeping the core runtime-neutral is just good hygiene: it means the Node adapter is the only place any platform code lives, and a future perf adapter would be an isolated drop-in rather than a fork.

### Execution model: stateless DAG + optional streaming

- Baseline is a **stateless DAG**: each invocation runs the graph once and produces a result. No durable/resumable state in v1 (§13).
- Ports may be **streams**, enabling a **dataflow** style where data flows incrementally with backpressure. Streaming is opt-in and mixes freely with value ports — the engine is not "all streams."

### Non-goals for v1

- Durable / resumable / long-running workflows. The design must not *preclude* this (state stays explicit and serializable), but it isn't built now.
- Distributed multi-machine scheduling — but nothing may architecturally prevent it (§4 invariants).
- Native persistence of run history. The engine **emits** traces; it doesn't store them (§10).
- The admin frontend.

---

## 2. Core concepts and vocabulary

| Term | Meaning |
|------|---------|
| **Op** | A reusable definition: a type id, typed input/output ports, a config schema, an execute function. Lives in the registry. |
| **Node** | An instance of an op placed in a workflow graph, with its own id and config. |
| **Port** | A typed input or output slot. Either a **value** port or a **stream** port. |
| **Edge** | A connection from one node's output port to another node's input port. |
| **Workflow** | A JSON document: a set of nodes + a set of edges. |
| **Boundary** | A special op that connects a workflow to the outside world. Most come as a **trigger** + **out-gate** pair. |
| **Run** | A single execution of a workflow, started by exactly one trigger firing, under a single **Principal**. |
| **Principal** | The identity a run executes as. Defaults to anonymous. |
| **Hook** | A named, ordered, payload-threading filter chain of workflows. |
| **Event** | A named fire-and-forget pub/sub signal. |
| **Control port** | A dataless port for **sequencing**. Every op has an implicit control-in (`in`) and control-out (`out`) so nodes can be chained for ordering even when no data passes between them. |

### Edge kinds — the central scheduling rule

Edge kind is **derived from port kinds**, not declared separately. There are three:

- **Value edge** (value-out → value-in): a **barrier**. The consumer waits until the producer fully resolves the value. Resolves once per run.
- **Stream edge** (stream-out → stream-in): **concurrent**. Producer and consumer run simultaneously; data flows incrementally with backpressure until the stream closes.
- **Control edge** (control-out → control-in): a **barrier carrying no data** — a pure sequencing pulse. The consumer waits until the producer has completed and pulsed. This is how you order side-effecting nodes ("log, *then* send, *then* respond") without inventing fake data dependencies.

A port can only connect to a port of the **same kind**. Bridging value↔stream requires an explicit adapter op:

- `core.stream.accumulate` — stream → value (collect/reduce; a barrier).
- `core.stream.emit` — value/iterable → stream.

`any`-typed ports are the escape hatch and bypass strict checking; use sparingly.

**Control ports in detail.** Every op implicitly exposes a single control-in (`in`) and a single control-out (`out`); wiring them is optional. For ordinary ops, `out` pulses automatically the moment the op completes (all its outputs resolved and streams drained). Control-flow ops (e.g. `core.flow.branch`, `core.flow.switch`) additionally declare **named** control-out ports (`then`/`else`, per-case) which they pulse selectively instead of the automatic `out`. A node with wired control-in edges waits for **all** of them to pulse before it can start (AND semantics).

---

## 3. Type system (Zod-pervasive)

Zod is the single sanctioned dependency in core. It describes port data types, config, the workflow document, boundary payloads, and hook payloads — giving runtime validation plus TypeScript inference end to end.

```ts
import { z } from "zod";

interface PortSpec {
  kind: "value" | "stream" | "control";
  /** Value port: the value's schema. Stream port: the element schema. Control port: none. */
  schema?: z.ZodTypeAny;
  /** Value inputs only. A stream input is "present" once wired. */
  required?: boolean;
  description?: string;
}

type Ports = Record<string, PortSpec>;
```

The implicit control ports (`in`/`out`) are not declared in `inputs`/`outputs` — the engine supplies them on every op. Only *extra* named control-outs (for control-flow ops) are declared, with `kind: "control"`.

Edge compatibility for `from A.out -> B.in`:

1. `A.out.kind === B.in.kind` (value↔value, stream↔stream, or control↔control); otherwise invalid — insert an adapter op for value/stream.
2. For value/stream edges, the producer schema must be assignable to the consumer schema (structural check at validation time; `z.any()` on either end is always compatible). Control edges carry no schema.

---

## 4. Distribution invariants

Distribution is not built in v1, but nothing may prevent it. Hold these from day one:

- **Serializability.** Workflow definitions, trigger inputs, run context (incl. Principal), and hook payloads must be serializable. Non-serializable handles (raw sockets) stay host-side; only their data crosses (e.g. request body as a chunk-forwarded byte stream).
- **Dispatch behind a transport.** Run dispatch goes through a `RunTransport` interface — in-process (dev) and a Node worker pool now; queue + remote workers later. The scheduler must not know which.
- **Bus & registry behind interfaces.** The event bus and hook registry have in-process default implementations but sit behind interfaces, so they can become network-backed without touching any workflow.
- **No shared mutable memory** across runs/ops; all coordination is via explicit channels (streams, events, hooks) that can be made network-transparent.
- **No host-local assumptions in ops** (filesystem, singletons) except through capabilities handed in via context.

```ts
interface RunTransport {
  dispatch(req: RunRequest): Promise<RunHandle>;   // returns a handle; streams flow back via the handle
}
```

Isolation is a **strategy** behind `RunTransport`: an in-process transport for dev, and a `node:worker_threads` worker pool for production. Keeping it behind the interface is what later allows a queue + remote workers (distribution) without touching the scheduler.

---

## 5. Op definition and authoring contract

```ts
interface OpDefinition {
  /** Globally unique, namespaced: "core.stream.split", "ai.agent", "boundary.http.request". */
  type: string;
  title?: string;
  inputs: Ports;
  outputs: Ports;
  /** Extra named control-out ports (for control-flow ops). The implicit `in`/`out` are always present and not declared here. */
  controlOut?: string[];
  config?: z.ZodTypeAny;          // validated against the node's `config`
  execute: OpExecute;
  boundary?: "trigger" | "outgate";
}

type OpExecute = (ctx: OpContext) => OpResult | Promise<OpResult>;

interface OpContext {
  config: unknown;                // parsed + validated
  input: {
    value<T = unknown>(port: string): Promise<T>;        // barrier: awaits upstream
    stream<T = unknown>(port: string): ReadableStream<T>; // available immediately
  };
  /** Pulse a declared named control-out (control-flow ops). The implicit `out` pulses automatically on completion. */
  pulse: (controlOutPort: string) => void;
  principal: Principal;           // identity (default anonymous) — §9
  signal: AbortSignal;            // cancellation
  trace: Span;                    // OTel-shaped span — §10
  log: (level: "debug" | "info" | "warn" | "error", msg: string, attrs?: Record<string, unknown>) => void;
}

/**
 * Output port name -> output.
 *  - Value output: a value or Promise of a value.
 *  - Stream output: a ReadableStream.
 * Returning value outputs as Promises lets a mixed op start streams immediately
 * while values resolve later.
 */
type OpResult = Record<string, unknown | Promise<unknown> | ReadableStream<unknown>>;
```

**Authoring rules**

- Read value inputs via `ctx.input.value(port)` — this is where barrier ordering happens.
- Read stream inputs via `ctx.input.stream(port)` — handed over immediately. The engine handles fan-out (one output stream wired to N consumers is teed automatically).
- A pure value op awaits inputs, computes, returns resolved values. A streaming op returns its `ReadableStream`s quickly (they produce lazily). A mixed op returns streams immediately + value promises.
- **Control ports are mostly invisible to op code.** An op doesn't read its control-in (it's a scheduling barrier) and doesn't fire its implicit `out` (the engine pulses it on completion). Only control-flow ops touch control: they declare `controlOut` ports and call `ctx.pulse(port)` to choose a path; their implicit `out` does not auto-pulse.
- Respect `ctx.signal`; stop producing when aborted.
- No shared mutable globals across runs (see §4).

### Registries

```ts
interface OpRegistry {
  register(op: OpDefinition): void;
  get(type: string): OpDefinition | undefined;
  list(): OpDefinition[];
}

interface AuthProviderRegistry {           // §9
  register(p: AuthProvider): void;
  chain(): AuthProvider[];
}

interface HookRegistry {                    // §8
  declare(def: HookDefinition): void;
  registrations(name: string): HookRegistration[];  // sorted by priority
}
```

Op `type` ids and hook names are stable contracts — treat them like a public API. Registries are populated by base ops and, later, by mods.

---

## 6. Workflow document format

```jsonc
{
  "$schema": "pattern/workflow/v1",
  "id": "chat-endpoint",
  "name": "Chat with streamed TTS",
  "version": "1",

  "nodes": [
    { "id": "in",    "op": "boundary.http.request" },
    { "id": "agent", "op": "ai.agent", "config": { "model": "claude-…" } },
    { "id": "split", "op": "core.stream.split", "config": { "branches": 2, "bufferPolicy": "backpressure" } },
    { "id": "tts",   "op": "audio.tts" },
    { "id": "out",   "op": "boundary.http.response", "config": { "mode": "sse" } }
  ],

  "edges": [
    { "from": { "node": "in",    "port": "body"   }, "to": { "node": "agent", "port": "prompt" } },
    { "from": { "node": "agent", "port": "tokens" }, "to": { "node": "split", "port": "in"     } },
    { "from": { "node": "split", "port": "out.0"  }, "to": { "node": "out",   "port": "body"   } },
    { "from": { "node": "split", "port": "out.1"  }, "to": { "node": "tts",   "port": "text"   } }
  ]
}
```

This is the agent → split(SSE + TTS) case: `agent.tokens` is `stream<string>`, split into two stream branches — one feeds the SSE response body, the other feeds TTS — so SSE flush and TTS synthesis run concurrently.

### Validation (load time)

1. Every node references a registered op; every config parses against the op's config schema.
2. Every edge references existing nodes/ports.
3. Edge endpoints have matching `kind` and compatible schemas (§3).
4. No cycles (v1 forbids cycles, including across stream edges).
5. At least one trigger node and a reachable out-gate for it (§7).

Validation errors are **human-readable** and name the offending node/port (Zod's error tree feeds this) — a first-class DX feature (§12).

---

## 7. Boundaries

Boundaries connect the graph to the outside world. Most come as a matched **trigger** + **out-gate** pair; hooks and events are special (below).

- A **trigger** has no graph inputs; its outputs are the external input. The boundary host fires it.
- An **out-gate** has no graph outputs; it consumes graph outputs and produces the external result. Out-gates are where an **in-process stream becomes an external wire format** (SSE, chunked HTTP).

The boundary **op contracts and payload schemas live in core**; the **host** that binds an external source to a trigger and writes the out-gate result is provided by the **runtime adapter** (HTTP server, CLI process binding, cron). This keeps core runtime-neutral and serves distribution.

| Trigger | Out-gate | Notes |
|---------|----------|-------|
| `boundary.http.request` | `boundary.http.response` | `mode: "buffered" \| "sse" \| "chunked"`. Inbound webhooks are just this. |
| `boundary.ws.message` | `boundary.ws.send` | Fires a run **per inbound message** on a connection. Trigger outputs: `message` (the payload), `connection` (a connection ref/id), `room?`. Out-gate `boundary.ws.send` sends a message back on that connection as the run's result (value or `stream<…>` for chunked sends). Related triggers: `boundary.ws.open` / `boundary.ws.close` (connection lifecycle). |
| `boundary.cli` | `boundary.cli.exit` | Trigger: `args` (raw `string[]` + optional parsed object), `stdin: stream<Uint8Array>`, `env`. Out-gate: `stdout` (value/stream), `stderr`, `code: number`. CLI is intrinsically host-local — acceptable. |
| `boundary.manual` | result | Fired programmatically; result returned to caller. |
| `boundary.schedule` | result | Cron/interval; result discarded or traced. |
| `boundary.hook` | returns payload | Filter-chain member — §8. |
| `boundary.event` | (none) | Fire-and-forget subscriber — §8. |

**WebSocket specifics.** The WS server lives in the runtime adapter (Node has no built-in WS *server* — `runtime-node` provides one, e.g. via `ws`, on the HTTP upgrade; that's an adapter-level dependency, core stays clean). A WS connection is **host-local** like a socket, so it can't cross machines directly: `connection` refs and the `ws.emit`/`ws.broadcast` ops route through a **connection registry behind an interface**, so a pub/sub backplane can be added later for distribution (consistent with §4). Outbound messaging is available both as the `boundary.ws.send` out-gate and as mid-run ops — see `core.ws.*` in §12.

### Multiple boundary pairs per workflow

A workflow **may** contain several triggers (e.g. HTTP *and* schedule driving shared ops). A run is initiated by **exactly one** trigger firing, and the engine executes only the **subgraph reachable from that trigger** down to its reachable out-gate(s). Other triggers/out-gates stay dormant for that run.

---

## 8. Hooks and Events

Two distinct extensibility primitives. Keep both.

### Events — fire-and-forget pub/sub

Asynchronous, unordered, no return value, subscribers independent.

- `core.event.emit` — inputs `{ payload }`, config `{ event }`, no outputs. Fire-and-forget.
- `boundary.event` trigger — config `{ event }`, output `payload`. No out-gate (nothing is returned).

```ts
interface EventBus {
  emit(event: string, payload: unknown): void;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
}
```

### Hooks — ordered, payload-threading filter chain

The `apply_filters` / Tapable pattern: a named, **blocking**, priority-ordered pipeline that threads a payload through every registered workflow and returns the final result.

- `core.hook.invoke` — inputs `{ payload }`, config `{ hook }`, outputs `{ payload }`. **Blocks** until the chain completes and returns the (possibly modified) payload.
- `boundary.hook` trigger — config `{ hook, priority }`. The trigger outputs `payload`; the workflow's out-gate returns `payload` (and optional `stop`).

```ts
interface HookDefinition<P = unknown> {
  name: string;                 // "user.beforeCreate"
  payload: z.ZodType<P>;        // undeclared hooks default to z.unknown()
  maxDepth?: number;            // recursion guard, default 16
}

interface HookRegistration {
  workflowId: string;
  nodeId: string;               // the boundary.hook trigger node
  priority: number;             // from the trigger node's config (§ semantics below)
}
```

**Semantics**

- **Priority** is a field on each listening workflow's `boundary.hook` trigger, fixed at registration, and is the **sole ordering key**. Chain runs in **ascending** priority (lower first), default `100`; deterministic tiebreak by node id only when two share a priority.
- **Payload threading.** Each registered workflow runs as its own run (its own Principal/context), receiving the payload as the previous one left it; the final payload returns to the invoker.
- **Fail-fast.** If a registered workflow throws, the chain aborts and the error propagates to the invoker. (Continue-on-error may be configurable later.)
- **Short-circuit.** A registered workflow's out-gate may set `stop: true` to halt the remaining chain and return the current payload (e.g. an auth hook rejecting).
- **Payload typing.** A hook is declared by name + Zod schema (by core or a mod); registrations and payloads are validated against it. Undeclared hooks default to `z.unknown()`.
- **Recursion guard.** A hook chain may fire another hook; invocation depth is tracked and exceeding `maxDepth` throws.

**Events vs hooks at a glance:** event = pub/sub, async, unordered, no return; hook = synchronous filter chain, priority-ordered, payload threaded, returns a result. Hooks are the extensibility backbone — where mods splice into lifecycle points to validate/enrich data.

---

## 9. Auth & identity (run context, not a boundary)

Auth is orthogonal to transport: every entry point wants to know "who is this running as." So identity is **run context**, not a boundary.

- **`ctx.principal`** is first-class, defaulting to anonymous. Core, not a mod.

```ts
type Principal =
  | { kind: "anonymous" }
  | { kind: "user"; id: string; provider: string; claims?: Record<string, unknown>; scopes?: string[] };
```

- **Auth providers are a registry.** Mods contribute them — `mod-oidc`, `mod-clerk`, `mod-magic-link` each resolve a principal their own way. Providers form a chain.

```ts
interface AuthProvider {
  name: string;                                   // "oidc", "clerk", "magic-link"
  authenticate(req: AuthContext): Promise<Principal | null>;
}
interface AuthContext { headers: Headers; raw: unknown; }
```

- **Triggers may declare an auth requirement** in config: `requireAuth?: boolean | { scopes: string[] }`. The boundary host runs the provider chain before the run; if required-but-anonymous it returns the boundary's unauthorized form (HTTP 401, CLI nonzero exit) without executing the graph; otherwise it runs anonymous.
- **Auth *flows* are ordinary workflows.** An OAuth callback is an HTTP trigger + provider ops; magic-link request/verify are two HTTP workflows.
- **User storage is a mod concern.** Core defines only `Principal` and `AuthProvider`; it never owns a user table. That is what keeps every auth paradigm open.

---

## 10. Observability — OTel-*shaped*, emit-don't-persist

The engine emits structured telemetry to a subscribable sink and stores nothing itself. To honor minimize-deps, core ships its **own zero-dependency span types** modeled on OTLP — *not* the OpenTelemetry SDK. A real OTLP/OTel exporter is an optional add-on or mod.

- One trace per run, one span per node (timing, status, op type, node id). Errors recorded on the failing node's span; the run span carries the terminal status.
- A no-op sink is the default; `engine.onTrace(sink)` subscribes.

```ts
interface TraceSink {
  onRunStart(run: { runId: string; workflowId: string; trigger: string; principal: Principal }): void;
  onSpanEnd(span: SpanData): void;     // one per node
  onRunEnd(run: { runId: string; status: "ok" | "error"; error?: unknown }): void;
}
```

---

## 11. Scheduler

The scheduler is the heart of the engine. It needs **no explicit topological sort for execution** — value-edge ordering is enforced by the promise deferreds themselves. (Topology is computed at validation time for cycle detection and reachability.)

```
function runWorkflow(workflow, triggerNodeId, triggerInput, principal, signal):
    graph = subgraph reachable from triggerNodeId

    // 1. One output slot per (node, outputPort), plus a control pulse per (node, controlOut).
    for node in graph, for outPort in node.outputs:
        slots[node][outPort] =
            outPort.kind == "value" ? new Deferred()      // resolves once
                                    : new StreamHub()      // tees to N consumers
    for node in graph, for cOut in (["out"] + node.controlOut):
        pulses[node][cOut] = new Deferred<void>()          // a dataless barrier

    // 2. Seed the trigger node's outputs from the external input.
    bindTriggerOutputs(triggerNodeId, triggerInput, slots)

    // 3. Launch every node concurrently; each blocks on its own inputs AND control-in.
    for node in graph (except trigger):
        spawn runNode(node, principal)

    // 4. Done when every reachable out-gate finishes and all streams drain.
    return await collectOutGates(graph, slots, signal)


async function runNode(node, principal):
    ctx.principal       := principal
    // control-in barrier: wait for ALL wired control-in producers to pulse
    await Promise.all(controlInEdges(node).map(e => pulses[e.from.node][e.from.port].promise))
    ctx.input.value(p)  := await slots[upstream(node,p)].promise        // barrier
    ctx.input.stream(p) := slots[upstream(node,p)].subscribe()          // tee per consumer
    ctx.pulse(cOut)     := () => pulses[node][cOut].resolve()
    result = await op(node).execute(ctx)
    for outPort, value in result:
        if outPort.kind == "stream": slots[node][outPort].connect(value)   // fan-out via tee
        else: Promise.resolve(value).then(v => slots[node][outPort].resolve(v))
    await nodeFullyComplete(node)                  // all outputs resolved + streams drained
    if node has no declared controlOut: pulses[node]["out"].resolve()      // auto-pulse on completion
```

**Key behaviours**

- A node starts once its value inputs resolve **and** all wired control-in edges have pulsed; stream input handles are available immediately, so streaming nodes start producing right away.
- A **control edge** is just a dataless barrier — the same machinery as a value edge, minus the payload. Ordinary ops auto-pulse `out` on completion; control-flow ops pulse one of their declared `controlOut` ports instead.
- `accumulate` is a barrier: a value-op downstream of it can't start until the upstream stream closes.
- `StreamHub.subscribe()` returns an independent teed `ReadableStream` per consumer; fan-out is transparent to ops.
- On any node error or external cancellation, the run aborts fast: `signal` fires, streams cancel, pending deferreds and pulses reject.

---

## 12. Core op catalog (base ops)

The ops the engine ships in `@pattern/core`. Built on plain TypeScript + Web standards — no framework substrate. The catalog grows over time; this is the v1 baseline. Naming convention: `core.<area>.<op>`.

Notes that apply throughout:
- **Higher-order ops** (anything that needs a "function": `array.map/filter/reduce`, etc.) take a **sub-workflow reference** applied per element, *or* are expressed via the stream bridge (`emit → stream.map → accumulate`). v1 leans on the stream bridge for the simple cases and sub-workflow refs for the rest.
- Unless noted, ports are **value** ports and the op is a run-once barrier.

### Constants / sources

| Op | Out | Notes |
|----|-----|-------|
| `core.const.string` / `.number` / `.boolean` / `.null` | `value` | Emit a configured literal of that type. |
| `core.const.object` / `.array` | `value` | Emit a configured object/array literal. |
| `core.const.json` | `value` | Arbitrary JSON literal (Zod-validated against an optional declared schema). |
| `core.input` | `value` | Read a run-scoped input/parameter by name. |

### Scalars — math, comparison, logic

| Area | Ops |
|------|-----|
| Math | `core.math.add` `subtract` `multiply` `divide` `modulo` `pow` `abs` `round` `floor` `ceil` `min` `max` `clamp` |
| Comparison | `core.cmp.eq` `neq` `gt` `gte` `lt` `lte` |
| Boolean | `core.bool.and` `or` `not` `xor` |
| Coercion | `core.cast.toString` `toNumber` `toBoolean` `typeof` `isNull` `coalesce` (first non-null) |

### Strings

`core.string.concat` `join` `split` `replace` (literal/regex) `trim` `lower` `upper` `slice` `length` `includes` `startsWith` `endsWith` `match` (regex) `pad` `template` (interpolate `{{ }}` from inputs).

### Objects

`core.object.get` (dot/path) `set` (path) `has` `delete` `pick` `omit` `merge` (shallow) `mergeDeep` `keys` `values` `entries` `fromEntries` `mapValues` `clone` (`structuredClone`) `build` (assemble an object by mapping input ports → keys).

### Arrays

`core.array.length` `at` `first` `last` `slice` `concat` `append` `prepend` `flatten` `flatMap` `unique` `sort` `reverse` `includes` `indexOf` `join` `chunk` `zip` `groupBy` `partition` `count` `range` (generate) — plus higher-order `map` `filter` `reduce` `find` `some` `every` (sub-workflow ref or stream bridge, per the note above).

### Control flow / workflow primitives

These are where **control ports** (§2) earn their keep.

| Op | Behaviour |
|----|-----------|
| `core.flow.branch` | Boolean `condition` → pulses control-out `then` or `else`. |
| `core.flow.switch` | Match a `value` → pulses the matching case control-out (or `default`). |
| `core.flow.gate` | Pass control through only if `condition` is true; otherwise the path stops here. |
| `core.flow.sequence` | Pulse a list of control-outs in order (each waits for the previous downstream to complete). |
| `core.flow.parallel` | Fan control-out to N branches at once. |
| `core.flow.join` | Converge N control-ins (waits for all) then pulses `out`. |
| `core.flow.delay` | Wait a configured duration, then pulse `out` (timer). |
| `core.flow.try` | Run a referenced sub-workflow; on error pulse `catch` with the error, else pulse `out`. |
| `core.flow.throw` | Raise an error (fails the run / triggers an enclosing `try`). |
| `core.flow.assert` | Fail unless `condition` holds. |
| `core.flow.noop` | Pure pass-through / sequencing point. |
| `core.flow.foreach` | Iterate a collection, running a sub-workflow per item (sequential or bounded-concurrent). |
| `core.log` | Emit a structured log line (to the trace sink, §10); pass-through. |

### Data & encoding

`core.json.parse` `json.stringify` · `core.encode.base64` / `decode.base64` · `core.encode.url` / `decode.url` · `core.url.parse` / `url.build` · `core.query.parse` / `query.build` (query strings).

### Time

`core.time.now` (timestamp) · `core.time.parse` · `core.time.format` · `core.time.add` / `time.subtract` (durations) · `core.time.diff`.

### Crypto / random

`core.random.number` · `core.random.uuid` · `core.random.pick` (from array) · `core.hash` (sha-256 etc. via `crypto.subtle`) · `core.crypto.hmac`.

### HTTP (outbound)

`core.http.fetch` — make an outbound request via `fetch`; inputs `{ url, method, headers, body }`, outputs `{ status, headers, body }` (body as value or `stream` for large/streamed responses).

### Streams (dataflow)

Built on Web Streams (`ReadableStream`/`TransformStream`) + async iterators.

| Op | Signature | Notes |
|----|-----------|-------|
| `core.stream.split` | `in: stream<T>` → `out.0..n: stream<T>` | Tee/fan-out. `bufferPolicy: "backpressure" \| { drop: maxItems }`. Default backpressure: a slow branch slows the source. |
| `core.stream.merge` | `a, b, …: stream<T>` → `out: stream<T>` | `ordering: "interleave" \| "concat"`. |
| `core.stream.accumulate` | `in: stream<T>` → `out: value<R>` | Reduce/collect. **Barrier.** `mode: "array" \| "concat" \| "reduce"`. |
| `core.stream.emit` | `in: value<T[] \| Iterable<T>>` → `out: stream<T>` | Value/iterable → stream. |
| `core.stream.map` | `in: stream<T>` → `out: stream<U>` | Per-element transform. |
| `core.stream.filter` | `in: stream<T>` → `out: stream<T>` | Predicate. |

### WebSocket

| Op | Behaviour |
|----|-----------|
| `core.ws.emit` | Send a message to a `connection` (input value or `stream<…>` for chunked sends). |
| `core.ws.broadcast` | Send a message to all connections in a `room`/topic. |
| `core.ws.join` / `core.ws.leave` | Add/remove a connection to/from a room/topic. |
| `core.ws.close` | Close a connection. |

(Connection refs and rooms resolve through the adapter's connection registry — see §7.)

### Hooks & events

`core.hook.invoke` (blocking filter chain) and `core.event.emit` (fire-and-forget) — defined in §8.

---

## 13. Future (designed-for, not built)

- **Resumable / durable workflows** — checkpointing + deterministic replay. Keep run state explicit and serializable (already required by §4) so this lands without a rewrite. `schedule`/auth flows are where it'll matter most.
- **Distributed execution** — the worker pool becomes a queue + remote workers behind the same `RunTransport`.
- **Mods** contributing ops, boundaries, and auth providers via the registries.
- **Admin UI** mod (React + Tailwind + Motion.dev + xyflow/react).

---

## 14. Monorepo & package layout

A framework whose pitch is extensibility benefits from real package boundaries early. Tooling: **pnpm workspaces** + **changesets** for versioning. Skip heavier orchestration until it hurts.

```
pattern/                         # monorepo root (workspaces + changesets)
  packages/
    core/                        # @pattern/core — runtime-neutral, Web-standard only
      src/
        types.ts                 # PortSpec, OpDefinition, Workflow, Edge, Principal, Hook/Event contracts
        registry.ts              # OpRegistry, AuthProviderRegistry, HookRegistry
        validate.ts              # load-time validation (human-readable errors)
        scheduler/{slots,run}.ts # Deferred, StreamHub, control pulses, runWorkflow/runNode
        streams/                 # split, merge, accumulate, emit, map, filter
        ops-core/                # const, math, cmp, bool, cast, string, object, array,
                                 #   flow (branch/switch/gate/…), json, encode, time,
                                 #   random, hash, http.fetch, ws (§12 catalog)
        boundaries/              # contracts + payload schemas (http, ws, cli, manual, schedule, hook, event)
        hooks/                   # HookRegistry + chain runner + invoke op
        events/                  # EventBus interface + in-process impl
        auth/                    # Principal, AuthProvider, provider chain
        transport/               # RunTransport interface + in-process impl
        observability/           # OTLP-shaped span types + TraceSink
        index.ts
    runtime-node/                # @pattern/runtime-node — node:http + ws host, node:worker_threads pool,
                                 #   connection registry, sqlite sink
    create-pattern/              # the scaffolder CLI
  templates/                     # hello-workflow, http-api, agent-sse-tts
  # later: mod-* (oidc, clerk, magic-link, …), docs, and an optional Bun-native perf adapter
```

"One real package for now" is honored by keeping the bulk in `@pattern/core`; `runtime-node` is thin and exists mainly to keep the core provably runtime-neutral (and to make any future perf adapter an isolated drop-in).

---

## 15. Developer experience

The installer is the front door, but the DX that *keeps* people is the deeper set.

**`create-pattern` scaffolder.** `npm create pattern@latest` / `pnpm create pattern`. Because `create-pattern` is a dev-time-only package, its deps never ship to production — so it can be rich: `@clack/prompts` (interactive flow, spinners/loaders), `picocolors` (tiny), a gradient ASCII banner.

- Flow: banner → pick template → package manager → optional mods → git init + install → teach-as-you-go next steps (introduce ops/workflows/boundaries while scaffolding — onboarding doubles as guidance).
- **Graceful non-TTY/CI degradation**: flag-driven, no prompts, no animation — stays scriptable.
- Templates: minimal "hello workflow", an HTTP API, and the agent + SSE + TTS case.

**Beyond the installer (first-class DX features, not afterthoughts):**

- **End-to-end types** — Zod-driven port inference so the graph is typed.
- **Human-readable validation errors** — the validator names the offending node/port (§6).
- **Dev loop** — `pattern dev` with workflow hot-reload; `pattern graph file.json` prints the graph in-terminal before the admin mod exists.

---

## 16. Implementation milestones

Build in order; each is independently testable.

1. **Types + validation** — `PortSpec` (value/stream/control), `OpDefinition`, `Workflow`, `Principal`, hook/event contracts; Zod schemas; load-time validation incl. type compatibility, cycles, boundary pairing; human-readable errors.
2. **Registries + op authoring contract** — `OpContext`/`OpResult`, `ctx.pulse`; a few trivial value ops; in-process single-node execution.
3. **Scheduler — value + control edges (pure DAG)** — Deferred slots, control pulses, `runNode`, barrier semantics, auto-pulse on completion.
4. **Streaming** — `StreamHub` (tee/fan-out), stream edges, mixed graphs, the six stream ops; test backpressure, split→2, merge, accumulate barrier.
5. **Core op catalog** — constants, scalars, strings, objects, arrays, control-flow ops (`branch`/`switch`/`gate`/`sequence`/`parallel`/`join`/`delay`/`try`/`foreach`/…), data/encoding, time, crypto/random, `http.fetch` (§12).
6. **Boundaries + HTTP + CLI** — `manual`, then `http.request`/`response` (buffered + SSE) and `cli`/`cli.exit` via a runtime host; run the §6 example end-to-end.
7. **WebSocket** — `boundary.ws.message`/`send` (+ open/close), connection registry, and `core.ws.*` ops, in `runtime-node`.
8. **RunTransport + worker isolation** — in-process transport, then a `node:worker_threads` worker-pool transport in `runtime-node`; streamed results + cancellation across the seam.
9. **Events + Hooks** — `EventBus`; `HookRegistry` + chain runner + `core.hook.invoke`; priority ordering, fail-fast, short-circuit, recursion guard, Zod payload validation.
10. **Auth** — `Principal` in context, `AuthProviderRegistry`, per-trigger `requireAuth`, anonymous default.
11. **Observability** — OTLP-shaped spans + `TraceSink`.
12. **Remaining boundaries** — `schedule`.
13. **`create-pattern` + dev loop** — scaffolder, templates, `pattern dev`, `pattern graph`.
14. **Mod loading** — register ops, boundaries, and auth providers from external plugins.

---

## 17. Testing strategy

- **Unit:** each op in isolation; stream ops with controlled producers.
- **Scheduler fixtures:** value-only; pure stream pipeline; mixed graph; fan-out (split→2); merge; accumulate barrier ordering; **control-only sequencing** (chain side-effecting noops); **branch/switch path selection**; control fan-in (`join` waits for all); error propagation + cancellation.
- **Backpressure:** a slow split branch must not unbounded-buffer under `backpressure`.
- **Boundary integration:** HTTP buffered + SSE; CLI stdin→stdout; **WebSocket message → ws.emit round-trip and broadcast**; the §6 agent/TTS/SSE workflow; multi-trigger routing.
- **Hooks:** priority ordering, payload threading, fail-fast, short-circuit, recursion-depth guard, payload schema rejection.
- **Auth:** anonymous default; provider chain resolution; `requireAuth` rejecting anonymous before graph execution.
- **Determinism:** identical inputs → identical value outputs (modulo intentionally non-deterministic ops).

---

## 18. Decisions of record

1. **Zod** pervasively (ports, config, workflow doc, boundary + hook payloads); the one sanctioned core dependency.
2. **Runtime-neutral core; single Node adapter.** The core has no platform code; the `runtime-node` adapter (`node:http`, `node:worker_threads`) is the only place it lives. Bun-native optimizations are out of scope for v1 and evaluated afterward.
3. **Three edge kinds, derived from port kind** — value (barrier+data), stream (concurrent), control (dataless sequencing pulse). Every op has implicit control-in `in` / control-out `out`; control-flow ops declare extra named control-outs. value↔stream bridging via explicit adapter ops (`accumulate`, `emit`).
4. **One run = one trigger,** executing only that trigger's reachable subgraph.
5. **Web-standard streams** (no framework substrate); ops stay plain functions.
6. **Auth is run context, not a boundary** — `Principal` (default anonymous) + `AuthProvider` registry + optional per-trigger requirement; flows are workflows; user storage is a mod concern.
7. **Hooks** = priority-ordered, payload-threading, fail-fast, short-circuitable filter chains with Zod-typed payloads and a recursion guard. **Events** = fire-and-forget pub/sub. Both kept, clearly distinct.
8. **Observability is OTLP-shaped, zero-dep;** real exporters are optional add-ons. Emit, don't persist.
9. **Distribution is an invariant, not a v1 feature** — serializable state, transport/bus/registry behind interfaces.
10. **No durability in v1;** run state stays explicit/serializable to allow it later.
11. **Cycles forbidden in v1.**
12. **WebSocket is a first-class boundary** (`ws.message`/`ws.send` + open/close) with `core.ws.*` ops; connections are host-local and routed via an adapter connection registry behind an interface (distribution-ready).
13. **Core ships a broad op catalog** (§12): constants, scalars, strings, objects, arrays, control-flow, data/encoding, time, crypto/random, HTTP fetch, streams, WebSocket. Higher-order ops use sub-workflow refs or the stream bridge.
14. **Monorepo from day one** (pnpm workspaces + changesets); bulk lives in `@pattern/core`.
15. **`create-pattern`** rich scaffolder (dev-time deps only); DX also = end-to-end types, readable validation errors, and a dev loop.
