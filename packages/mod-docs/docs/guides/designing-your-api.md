---
title: Designing your API
order: 13
---

# Designing your API

You can build a working backend on Pattern several ways — and most of them are
traps that look like progress. This guide is the shape to aim for, and the
wrong turns to skip. It's the single most important pattern in the framework,
distilled from an agent that built a real app and only converged after four
detours.

The destination, in one line: **one workflow per action, ops that never see
HTTP, inputs decomposed to the field, outputs kept at domain granularity.**

## One workflow per action

Give every operation its own route workflow: `POST /api/members`,
`PATCH /api/members/:id`, `PUT /api/allocations`, … One workflow = one traced
run = one node graph you can observe, replay, and validate on its own.

The tempting shortcut is a single fat endpoint —
`POST /api/command` taking `{ entity, action, payload }` and switching inside.
**Don't.** It collapses every operation into one opaque run, throws away
per-route schema validation, and discards the framework's biggest win: the
admin's Runs view as a per-action debugger.

## Ops never see HTTP

The boundary owns the web. Push validation, auth, and status to the edge and
keep the op a pure domain function:

- **Validation** — put a JSON Schema on `boundary.http.request`'s `body` /
  `query` / `params`. The engine returns **400 with located `issues`** *before*
  your graph runs. Validated values flow out of the trigger's ports.
- **Auth** — `requireAuth: { scopes: ["edit"] }` on the trigger gives you
  **401 / 403** at the boundary (set it with the editor's auth selector, or wire
  it from a `core.env`/`core.const` source — it resolves once at registration).
  No in-op scope checks. If an op reads sensitive data, tag it
  `sensitivity: "privileged"`: the validator then *warns* whenever a network
  trigger can reach it without `requireAuth` — a forgotten gate is caught while
  the op stays pure.
- **Status** — defaults to **200**. Wire a `status` only for the exceptions.

An op that takes `body`/`params` and emits `{ status, body }`, checking scopes
inside, *works* — which is exactly why it's the seductive wrong turn. It
couples the op to HTTP: you can't call it from a CLI, a schedule, or another
workflow, and auth + status become domain-logic leaks. Keep the op speaking
domain ports and it's reusable from any caller.

## The asymmetry: decompose inputs, keep outputs whole

This is the key insight, and it is deliberately **not** symmetric.

**Inputs — decompose to the field.** Extract each value the op needs into its
own port with a `core.object.get` node (`config.path: "name"`,
`object ← request.body`; a path `:id` comes from `request.params` the same
way). The request→op mapping becomes a set of visible, traceable, rewireable
edges instead of one opaque blob.

**Outputs — keep at domain granularity.** Give the op a single meaningful
output port (`client`, `member`, `state`) and wire it straight into
`boundary.http.response.body`. Reach for `core.object.build` **only** when the
response is a deliberate projection (rename / pick / merge) or assembled from
several ops — *not* to rebuild the entity the op already returned. Exploding an
entity into per-field output ports and reassembling the identical object is
theater: nodes without meaning, and it couples the op's outputs to the HTTP
response shape.

A `POST /api/members` create, end to end — body fanned into fields, a pure
domain op, its `member` wired straight to the response:

```workflow
{ "id": "members.create",
  "name": "POST /api/members",
  "nodes": [
    { "id": "in",     "op": "boundary.http.request", "title": "POST /api/members", "config": { "method": "POST", "path": "/api/members" } },
    { "id": "name",   "op": "core.object.get", "config": { "path": "name" } },
    { "id": "role",   "op": "core.object.get", "config": { "path": "role" } },
    { "id": "create", "op": "app.members.create", "comment": "pure domain op — no HTTP" },
    { "id": "out",    "op": "boundary.http.response" }
  ],
  "edges": [
    { "from": { "node": "in",     "port": "body" },   "to": { "node": "name",   "port": "object" } },
    { "from": { "node": "in",     "port": "body" },   "to": { "node": "role",   "port": "object" } },
    { "from": { "node": "name",   "port": "out" },    "to": { "node": "create", "port": "name" } },
    { "from": { "node": "role",   "port": "out" },    "to": { "node": "create", "port": "role" } },
    { "from": { "node": "create", "port": "member" }, "to": { "node": "out",    "port": "body" } }
  ] }
```

`body → fields → op → response` is all visible nodes; the 4xx story is
declarative; each action is its own traced run; and `app.members.create` speaks
domain ports, so it's callable from anywhere.

## Gotcha: declare the input shape in one place

The validator does structural edge type-checking. If you put a JSON Schema on
`request.body` **and** a Zod schema on the op's input port, the edge
`request.body → op.input` can fail with
`… is not assignable to input "…" (schema mismatch)` — enums and nullable
fields don't reconcile between the two representations.

Declare the shape **once**. For HTTP inputs the boundary JSON Schema is the
right home — it's what returns the 400. Keep op ports plain `value()` and let
your domain / store layer guard invariants, so the op stays safe when called
outside HTTP too.

## The ladder of wrong turns

Each rung looks like a reasonable place to stop. Name them so you don't:

1. **One fat dispatch endpoint** — `POST /api/command` switching on
   `{ entity, action }`. Throws away per-action tracing and per-route
   validation. → *one workflow per action.*
2. **Granular routes, HTTP-coupled ops** — each action its own route, but the
   ops take `body`/`params`, return `{ status, body }`, and check scopes
   inside. Works, looks granular — and the op is unusable off HTTP. → *ops
   never see HTTP.*
3. **Pure ops, one opaque `input` blob** — boundary validates, op is pure, but
   it takes the whole body on a single `input` port and returns the whole
   entity on one `out`. The graph still hides *what data* flows. (Also where the
   schema-mismatch gotcha bites.) → *decompose inputs to the field.*
4. **Over-corrected outputs** — inputs fully discrete, but every output also
   exploded into per-field ports and rebuilt with `core.object.build`. Symmetry
   for its own sake; the build node adds nodes without meaning. → *keep outputs
   at domain granularity.*
5. **The destination** — discrete inputs (a `core.object.get` per field), a
   single domain output wired to the response, `core.object.build` reserved for
   genuine projections. Legible without being ceremonial.

See also [Create an app](creating-an-app.md) for serving a frontend over this
API, [Recipes](recipes.md) for the route backbone, and
[Authoring ops](authoring-ops.md) for keeping the op itself pure.
