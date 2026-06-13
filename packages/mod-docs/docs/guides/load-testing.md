---
title: Load testing
order: 17
---

# Load testing with `pattern load`

`pattern load <scenario.json>` drives HTTP load at a workflow app and reports
not just *that* it's slow but *where* — because it boots your app in-process
and attaches a **flight recorder** to the engine, so client-side latency sits
right next to per-node span time. Generic load tools (k6, autocannon) can't
see inside the engine; this one runs in the same process.

## A scenario is data

```json
{
  "version": 1,
  "warmup": { "rate": 10, "durationMs": 2000 },
  "stages": [{ "rate": 200, "durationMs": 10000 }],
  "requests": [
    { "weight": 3, "method": "GET",  "path": "/hello" },
    { "weight": 1, "method": "POST", "path": "/echo", "body": { "msg": "hi" } }
  ]
}
```

Requests are picked by `weight`. Stages run in order, each a constant arrival
rate for a duration. Omit `entry` (or leave it) to boot `src/index.ts`
in-process; set `"entry": false` and pass `--url` to fire at an
already-running server (client metrics only — no span attribution).

## Open-loop, on purpose

Requests launch on a fixed schedule, **not** after the previous one returns.
Closed-loop tools (fixed concurrency) quietly throttle themselves when the
server slows, so they measure its pace, not its ceiling. Open-loop holds the
pressure constant and lets latency reveal the limit. Latency is measured from
the *scheduled* time, so a generator that itself falls behind still counts
that lag (no coordinated omission).

## The report

```
  200/s for 10s → 2000 reqs, 199/s achieved
    status: 200×2000
    latency: p50 2.1ms  p90 3.3ms  p99 14.1ms  max 20.4ms  mean 2.3ms
    engine: 2000 runs, peak concurrency 7
    where the time went (by op, total span ms):
      store.put              ████████████ 61%  2000× · p99 9ms
      agents.run             ████ 22%  2000× · p99 4ms
      boundary.http.response █ 9%  2000× · p99 1ms
```

The latency line is the symptom; the **where the time went** block is the
diagnosis — span time rolled up by op across the window, ranked. "p99 is
mostly `store.put`" is a sentence you can act on. `peak concurrency` is how
deep run parallelism got — a flat ceiling under rising load means the worker
pool or a lease is the bottleneck.

## Find the ceiling

```sh
pattern load scenario.json --sweep --p99 100
```

`--sweep` ignores the stages and steps the rate (10, 25, 50, 100, 200, 400,
800…), stopping at the **knee** — the first rate where p99 crosses the budget
(`--p99`, default 1000ms) or errors climb past 2%. It reports the max
sustainable rps and which op dominated at the knee.

## Flags

| flag | meaning |
|------|---------|
| `--sweep` | saturation sweep instead of the scenario's stages |
| `--p99 <ms>` | p99 budget that defines the sweep's knee (default 1000) |
| `--url <u>` | fire at a running server (no in-process boot, no span data) |
| `--out <file>` | write the full report as JSON (CI artifact, before/after diffs) |

The JSON artifact makes regressions diffable: capture a baseline, change the
pipeline, compare. Scenarios are data — commit them next to the workflows
they exercise.
