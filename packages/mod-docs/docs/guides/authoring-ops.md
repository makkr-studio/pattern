---
title: Authoring ops
order: 12
---

# Authoring ops & mods

Ops are where the code lives. They're plain functions over Web-standard APIs,
with no framework substrate. This is how you add your own, and bundle them as a mod.

> **Reuse before you create.** Most "glue" is already an op: check the
> [op reference](/ops) (or `pattern ops <query>`) first. The base catalog
> covers strings, objects, arrays, math, control flow, time, encoding, HTTP, and
> streams. Author a new op when you have genuinely new *logic* or a new I/O
> capability. Wiring existing ops together is a workflow.

## A pure value op

Most ops await some value inputs, compute, and return one value. `pureOp`
captures that shape:

```ts
import { pureOp, required, z } from "@pattern-js/core";

export const slugify = pureOp({
  type: "app.slugify",
  inputs: { value: required(z.string()) },
  output: z.string(),
  compute: ({ value }) => String(value).toLowerCase().trim().replace(/\s+/g, "-"),
});

engine.registerOp(slugify);
```

Declared value inputs are awaited in parallel and handed to `compute` as an
object; the return value becomes the `out` port. Unwired optional inputs arrive
as `undefined`.

## The full contract

For streaming, control, multiple outputs, or sub-workflow invocation, author
against `OpDefinition` with `defineOp`:

```ts
import { defineOp, stream, value, z } from "@pattern-js/core";

export const lines = defineOp({
  type: "app.lines",
  inputs: { text: value(z.string()) },
  outputs: { lines: stream(z.string()) },   // a stream output
  execute: async (ctx) => {
    const text = (await ctx.input.value<string>("text")) ?? "";
    return {
      lines: new ReadableStream<string>({
        start(controller) {
          for (const l of text.split("\n")) {
            if (ctx.signal.aborted) break;     // respect cancellation
            controller.enqueue(l);
          }
          controller.close();
        },
      }),
    };
  },
});
```

Keep ops **auth-free**: never read `ctx.principal` to allow/deny. Authorization
is the trigger's job (`requireAuth` on the boundary), so the op stays callable
from a CLI, a schedule, or another workflow. If an op reads sensitive data, set
`sensitivity: "privileged"` on the definition: it's a *signal* the validator
reads, the op itself never enforces, and the validator warns if a network trigger
can reach it without `requireAuth`. See *Designing your API* for the full discipline.

`OpContext` gives you:

| | |
|---|---|
| `ctx.config` | parsed + validated against the op's `config` schema |
| `ctx.input.value(port)` | awaits an upstream value (the barrier) |
| `ctx.input.stream(port)` | a `ReadableStream`, available immediately, teed per consumer |
| `ctx.input.has(port)` | whether an input port is wired |
| `ctx.pulse(controlOut)` | pulse a declared named control-out (control-flow ops); returns a promise that resolves when that branch's subgraph quiesces |
| `ctx.principal` | the run identity (§9) |
| `ctx.signal` | `AbortSignal`: stop producing when aborted |
| `ctx.trace` / `ctx.log` | the node's OTel-shaped span / structured logging |
| `ctx.params` | run-scoped parameters (read by `core.input`) |
| `ctx.env` | injected environment map (read by `core.env`) |
| `ctx.invoke(ref, input)` | run a sub-workflow to completion (higher-order ops) |
| `ctx.services` | capabilities: `events`, `hooks`, `connections` |

### Authoring rules

- Read value inputs via `ctx.input.value`: that's where barrier ordering happens.
- Return streams quickly; they produce lazily. A *mixed* op returns streams immediately + value promises that resolve later.
- **Control ports are mostly invisible.** Ordinary ops don't read `in` or fire `out`; the engine does. Only control-flow ops declare `controlOut` and call `ctx.pulse`.
- No shared mutable globals across runs. Reach the outside only through `ctx` capabilities: that's what keeps distribution open.

## Replay-safety: `effects`, seals, and verdicts

Durable execution (retry, resume, re-run) needs to know what happens if your
op runs twice. Three things to get right:

1. **Stamp `effects`.** `"pure"` (no external mutation), `"idempotent"`
   (repeating converges — a CAS write, a provider call sealed with an
   idempotency key), or `"external"` (a send, a charge, a generation — a
   repeat duplicates it). *Absent means external*: an unstamped op reads as
   "ask before re-running", never "silently double-charge". `effects` may be
   a function of config (`core.http.fetch`: GET ⇒ idempotent, POST ⇒ external).
2. **Seal provider calls with `ctx.rootRunId`.** It's the first run of the
   resume lineage (= `ctx.runId` for a fresh run), so an idempotency key
   pinned to `` `${ctx.rootRunId}:${ctx.nodeId}` `` stays identical when a
   resume re-executes the node: the provider replays its stored response
   instead of acting twice. Per-node retries share it too. A re-run from
   start is a new lineage on purpose. (mod-billing's ops do exactly this.)
3. **Give failures a verdict.** An `external` op that throws is *ambiguous*
   by default — a provider can accept the charge and lose the response, so
   "it threw" never proves "it didn't happen". When you *know* nothing left
   the process (missing config, an unresolvable secret, invalid input) or the
   provider refused outright (a 4xx that isn't an idempotency clash), wrap the
   error: `throw noEffect(new Error(…))`. Resume then re-runs that node
   without a human call; without the stamp, the run detail lists it in the
   ambiguous zone and waits for confirmation.

## A control-flow op

Declare `controlOut` ports and pulse selectively. The engine marks the ones you
*don't* pulse as skipped:

```ts
export const isEven = defineOp({
  type: "app.isEven",
  inputs: { n: required(z.number()) },
  outputs: {},
  controlOut: ["even", "odd"],
  execute: async (ctx) => {
    const n = await ctx.input.value<number>("n");
    void ctx.pulse(n % 2 === 0 ? "even" : "odd");
    return {};
  },
});
```

## Dynamic-arity ports

`inputs`/`outputs`/`controlOut` may be functions of parsed config: that's how
`core.stream.split` produces `out.0..n`:

```ts
outputs: (config: { branches?: number }) =>
  Object.fromEntries(
    Array.from({ length: config.branches ?? 2 }, (_, i) => [`out.${i}`, stream()]),
  ),
```

## Higher-order ops

Take a sub-workflow reference in config and call `ctx.invoke` per element. The
sub-workflow needs a `boundary.manual` trigger whose `outputs` cover the keys you
pass, and a `boundary.return`/`boundary.return.named` out-gate:

```ts
const res = await ctx.invoke({ workflowId: "double" }, { item, index });
const mapped = "value" in res ? res.value : undefined;
```

## Bundling a mod

A mod contributes ops, auth providers, hooks, and workflows behind one object:

```ts
import type { PatternMod } from "@pattern-js/core";

const mod: PatternMod = {
  name: "my-mod",
  ops: [slugify, lines, isEven],
  authProviders: [/* … */],
  hooks: [{ name: "post.beforeSave" }],
  setup(engine) { /* anything imperative */ },
  ready(engine) { /* after every mod of the install batch: cross-mod work */ },
};

export default mod;        // engine.use(mod), or loadMods(engine, ["my-mod"])
```

Op `type` ids and hook names are stable contracts: treat them like a public API.
