/**
 * Pattern — the trace clock (§10).
 *
 * High-resolution epoch milliseconds: `performance.timeOrigin` (the process's
 * wall-clock start, epoch ms) + `performance.now()` (a monotonic offset,
 * sub-millisecond). Same "epoch ms" meaning as `Date.now()` but float-precise
 * and monotonic within a process — so a fast node no longer rounds to 0 ms and
 * a span duration can't go negative from a wall-clock adjustment mid-run.
 *
 * `performance` is a Web Performance global (Node ≥16, worker threads, browsers),
 * so core stays runtime-neutral — no `node:perf_hooks` import.
 */
export const now = (): number => performance.timeOrigin + performance.now();
