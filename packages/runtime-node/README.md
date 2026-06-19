# @pattern/runtime-node

The Node runtime adapter for [Pattern](../../README.md). Thin by design — it binds
external sources to boundary triggers and provides isolation. All platform code
lives here so `@pattern/core` stays runtime-neutral.

```bash
npm install @pattern/core @pattern/runtime-node
```

## Project loader (recommended)

```ts
import { loadProject } from "@pattern/runtime-node";

const { engine, start } = await loadProject();  // reads pattern.config.json
const { ports } = await start();                // derives routes from workflows
```

`loadProject` installs mods, loads workflow `.json` files, and returns a ready
HTTP host. See [projects & mods](../mod-docs/docs/guides/projects-and-mods.md).

## Hosts

Routing is **declarative**: the HTTP host derives routes from the
`boundary.http.request` nodes of registered workflows (method/path/port/cors/
body+query JSON-Schema all in config). No programmatic route table.

```ts
import { Engine } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";

const engine = new Engine();
engine.registerWorkflow(api);                 // route declared inside the workflow
const host = createHttpHost(engine, { defaultPort: 3000 });
const { ports } = await host.start();         // re-derives live as workflows change
```

| Host | Binds | Out-gate |
|------|-------|----------|
| `createHttpHost` | `boundary.http.request` (declarative routes) | `boundary.http.response` (`buffered`/`sse`/`chunked`) |
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
