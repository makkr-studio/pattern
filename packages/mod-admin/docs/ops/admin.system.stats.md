A health snapshot for the Process page: `host` (platform, CPUs, load average,
memory, uptime), `process` (pid, Node version, `cpuPercent`, RSS and heap),
`eventLoop` (`utilization` from 0 to 1 and delay `p50Ms`, `p99Ms`, `maxMs`)
and `transport` (the engine's description of how it dispatches runs).

CPU and event-loop figures are deltas since the previous call, so poll at a
steady interval and read each response as that interval's reading. The
counters are shared per process: two pollers each see shorter, noisier
intervals. `cpuPercent` is relative to one core and can exceed 100 with
workers.

Route: `GET /admin/api/system/stats`. Scope: `admin` (root).
