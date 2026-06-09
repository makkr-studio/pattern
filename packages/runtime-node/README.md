# @pattern/runtime-node

The Node runtime adapter for [Pattern](../../README.md). Thin by design — it binds
external sources to boundary triggers and provides isolation. All platform code
lives here so `@pattern/core` stays runtime-neutral.

```bash
npm install @pattern/core @pattern/runtime-node
```

## Hosts

```ts
import { Engine } from "@pattern/core";
import { createHttpHost, runCli, createWsHost, createScheduleHost } from "@pattern/runtime-node";

const engine = new Engine();
engine.registerWorkflow(api);

// HTTP — buffered / SSE / chunked, :param routing, auth enforcement
const host = createHttpHost(engine, { routes: [{ method: "GET", path: "/hello/:name", workflow: "api" }] });
const { port } = await host.listen(3000);
```

| Host | Binds | Out-gate |
|------|-------|----------|
| `createHttpHost` | `boundary.http.request` | `boundary.http.response` (`buffered`/`sse`/`chunked`) |
| `createWsHost` | `boundary.ws.message` / `open` / `close` | `boundary.ws.send` |
| `runCli` | `boundary.cli` | `boundary.cli.exit` |
| `createScheduleHost` | `boundary.schedule` (interval or 5-field cron) | result discarded/traced |

## Isolation: worker-thread pool

A `RunTransport` that runs each workflow on a `node:worker_threads` worker — a
drop-in for the in-process transport. Streamed out-gate results are reconstructed
on the host; cancellation crosses the seam.

```ts
import { WorkerPoolTransport } from "@pattern/runtime-node";
const engine = new Engine({ transport: new WorkerPoolTransport({ size: 4 }) });
```

## Also here

- **`NodeConnectionRegistry`** — `ConnectionRegistry` bound to live WebSocket sockets (rooms, broadcast, streamed sends).
- **Trace sinks** — `jsonlTraceSink(path)` and `sqliteTraceSink(path)` for persistence (core only emits).
- **`loadMods(engine, specifiers)`** — load external plugin mods by module specifier.
- **`pattern` CLI** — `pattern graph|validate|dev`.

## CLI

```bash
pattern graph workflow.json      # render the graph in the terminal
pattern validate workflow.json   # located, human-readable validation errors
pattern dev [entry]              # run an entry with file-watch hot-reload
```
