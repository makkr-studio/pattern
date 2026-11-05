The worker-efficiency benchmark on the Process page. It runs the same
CPU-bound workload (`core.math.fib` at index `n`) `runs` times concurrently,
first inline on this event loop, then on a fresh worker pool of `workers`
threads, and reports wall time, worst event-loop stall and loop utilization
for each phase, plus the pool's spawn cost and the `speedup`. Inputs are
clamped: `n` from 20 to 40 (default 34), `runs` from 1 to 16 (default 4),
`workers` up to the machine's available parallelism.

The inline phase blocks the host's event loop on purpose, so every request
this process serves stalls while it runs. Use it on a development or staging
host. The workload runs on throwaway engines and leaves the live one alone.

Route: `POST /admin/api/system/bench` with `{ n?, runs?, workers? }`. Scope:
`admin` (root).
