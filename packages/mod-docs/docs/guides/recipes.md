---
title: Recipes
order: 20
---

# Recipes

Common wirings, each a few nodes. Copy the shape, swap the middle. Every one
is just a workflow — author it in the admin, drop it in `workflows/`, or build
it from code.

## An HTTP endpoint

The two-boundary backbone of every route:

```
boundary.http.request → (your ops) → boundary.http.response
```

The route lives in the request node's config (method, path, CORS, body/query
JSON-Schema — validated before your graph runs). Gate it with `requireAuth`:
`true`, `{ "scopes": ["admin"] }`, or the env-deferred `{ "env": "MY_FLAG" }`
so a deployment switch follows the workflow even after a fork.

## A streaming (SSE) response

Wire a stream-typed producer into the response's `stream` port with
`mode: "sse"`. One subtlety: an out-gate whose only wired input is a stream
captures it immediately — on a branched workflow (e.g. a 409 path),
control-gate the response (wire the ok branch's pulse into the response
node's `in`) or the dead branch serves an eternally-open empty stream.

## A tool the agent can call

A tool is a workflow with a `boundary.tool` trigger (config: name,
description, a JSON-Schema `params` the engine validates) and a
`boundary.tool.return` out-gate. Drop it in the app and every agent picks it
up via `agents.tools.workflows`. The whole thing, end to end:

```workflow
{ "id": "tool-time",
  "nodes": [
    { "id": "in",  "op": "boundary.tool" },
    { "id": "now", "op": "core.time.now" },
    { "id": "fmt", "op": "core.time.format" },
    { "id": "out", "op": "boundary.tool.return" }
  ],
  "edges": [
    { "from": { "node": "in",  "port": "out" },       "to": { "node": "now", "port": "in" } },
    { "from": { "node": "now", "port": "out" },       "to": { "node": "fmt", "port": "timestamp" } },
    { "from": { "node": "fmt", "port": "out" },        "to": { "node": "out", "port": "result" } }
  ] }
```

The model's hallucinated arguments can never reach your graph — they're
validated against `params` at the trigger first. And the call runs as a
**linked sub-run**, so the admin's run view is your tool debugger.

## A webhook with signature verification

```
boundary.http.request → core.crypto.hmac (key ← vault.read) → core.cmp.eq → core.flow.gate → (handle)
```

Read the signing secret from the vault, HMAC the raw body, compare to the
provider's signature header, and gate the rest of the workflow on the match.

## A scheduled job

```
boundary.schedule (cron: "0 * * * *") → (your ops)
```

The schedule host arms itself from the registered workflows — edit the cron
in config, the schedule re-arms. No separate job runner.

## Fan-out: one event, many reactions

Emit a named event (`core.event.emit`); every workflow with a matching
`boundary.event` trigger runs independently. Fire-and-forget, unordered — use
a **hook** (`core.hook.invoke` ↔ `boundary.hook`) instead when you need an
ordered, threaded result back.

## Tee a stream to two consumers

`core.stream.split` (config `branches: 2`) sends one producer's stream to N
backpressured copies — e.g. an agent's token stream to both an SSE response
AND a persistence sink (exactly what the chat turn pipeline does).
