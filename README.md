<div align="center">

# Pattern

**A workflow execution engine — and the foundation for a framework.**

Workflows are *data*, not code. Ops carry the code. The engine runs a typed
graph to completion per invocation, with value barriers, concurrent streams, and
dataless control sequencing — all derived from how you wire the ports.

</div>

---

## What it is

A **workflow** is a JSON document describing a directed graph of typed **ops**
connected by **edges**. The engine runs the subgraph reachable from a trigger and
produces a result. Because workflows are data, they are portable, inspectable,
diffable, versionable — and the basis of the plugin (“mod”) system.

```
request → agent(tokens: stream) → split(2) ─┬─▶ SSE response body
                                             └─▶ TTS synthesis
```

Four defining properties (see [the spec](./pattern-engine-spec.md)):

1. **Workflows are data, not code.** Just op references + config; the engine never `eval`s.
2. **Ops carry the code.** Each node is an instance of an op — typed input/output ports + an `execute`.
3. **The workflow is the unit of isolation.** A whole run can execute off the host loop via a worker pool.
4. **Runtime-neutral core, Node adapter.** Core is plain TypeScript over Web standards; all platform code lives in `@pattern/runtime-node`.

## Quickstart

```bash
npm create pattern@latest          # scaffold a project (interactive)
# or: pnpm create pattern my-app --modpack studio   # engine + visual admin
```

Or use the engine directly:

```ts
import { Engine, type Workflow } from "@pattern/core";

const greeting: Workflow = {
  id: "greeting",
  nodes: [
    { id: "in",    op: "boundary.manual", config: { outputs: ["name"] } },
    { id: "greet", op: "core.string.template", config: { template: "Hello, {{ name }}!" } },
    { id: "out",   op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in",    port: "name" }, to: { node: "greet", port: "data"  } },
    { from: { node: "greet", port: "out"  }, to: { node: "out",   port: "value" } },
  ],
};

const engine = new Engine();           // base op catalog auto-registered
engine.registerWorkflow(greeting);     // validates with human-readable errors

const result = await engine.run(greeting, { input: { name: { name: "world" } } });
console.log(result.outputs);            // { out: { value: "Hello, world!" } }
```

## The central idea: three edge kinds

Edge kind is **derived from port kinds**, never declared separately:

| Edge | From → To | Semantics |
|------|-----------|-----------|
| **Value** | value-out → value-in | **Barrier.** The consumer awaits the produced value. Resolves once per run. |
| **Stream** | stream-out → stream-in | **Concurrent.** Producer and consumer run together; data flows incrementally with backpressure. |
| **Control** | control-out → control-in | **Dataless barrier.** A pure sequencing pulse — order side effects without inventing fake data. |

Every op has an implicit control-in `in` and control-out `out`. Ordinary ops
auto-pulse `out` on completion; control-flow ops (`branch`, `switch`, `gate`, …)
pulse named control-outs instead. Crossing value↔stream is explicit:
`core.stream.accumulate` (stream→value) and `core.stream.emit` (value→stream).

> The scheduler needs **no topological sort**: value ordering falls out of promise
> deferreds, control ordering out of dataless pulses, stream fan-out out of a
> backpressured hub. A branch not taken propagates a *skip* through the unreached
> subgraph so it settles cleanly instead of hanging.

## Packages

| Package | What |
|---------|------|
| [`@pattern/core`](./packages/core) | The runtime-neutral engine: types, validation, scheduler, streams, the [op catalog](./docs/op-catalog.md), hooks/events, auth, observability. One dependency: Zod. |
| [`@pattern/runtime-node`](./packages/runtime-node) | Node adapter: HTTP/WebSocket/CLI/schedule hosts, `node:worker_threads` pool transport, socket-bound connection registry, JSONL/SQLite trace sinks, the `pattern` CLI. |
| [`@pattern/mod-admin`](./packages/mod-admin) | The admin mod: an authorable, self-reflecting control surface — control plane, workflow store + versioning, run/metrics sink, the `admin.*` ops + workflow-backed HTTP API, and a React 19 / xyflow / Tailwind v4 glassmorphism **SPA** (catalog, graph editor, runs+replay, versions+diff, system map, metrics). |
| [`@pattern/admin-sdk`](./packages/admin-sdk) | The admin extension surface: a typed API client over the workflow-backed endpoints (incl. SSE tail) + nav/command helpers + shared protocol types. |
| [`@pattern/mod-identity`](./packages/mod-identity) | The optional [identity brick](./docs/identity.md): users, revocable cookie sessions (CAS-backed sqlite), roles→scopes, single-use token kernel, login page, bootstrap-on-first-boot, WS session rooms, admin Users/Sessions screens. Installing it flips the admin to secure-by-default. |
| [`@pattern/mod-auth-magic-link`](./packages/mod-auth-magic-link) | Email magic-link login — the reference identity provider mod. Delivery via the `identity.deliverToken` hook; the console fallback doubles as the zero-config dev login. |
| [`@pattern/mod-store`](./packages/mod-store) | Generic persistence for [agents & apps](./docs/agents-and-chat.md): JSON document collections with declared indexes, a blob store, and TTL'd CAS **leases** with run-settle auto-release. SQLite or memory; admin Data browser. |
| [`@pattern/mod-vault`](./packages/mod-vault) | Encrypted-at-rest secrets (AES-256-GCM, `PATTERN_VAULT_KEY`): a `vault.read` node whose values are masked out of run samples, plus a write-only Secrets admin screen. |
| [`@pattern/mod-agents`](./packages/mod-agents) | The neutral [agent contracts](./docs/agents-and-chat.md): agent/toolset/guardrail descriptors on edges, the turn event protocol, the `boundary.tool` workflow pair (engine-validated params, linked sub-runs), the live tool registry. |
| [`@pattern/mod-agents-openai`](./packages/mod-agents-openai) | The OpenAI Agents SDK provider: streaming `agents.run`, HITL `agents.run.resume`, MCP servers (pooled), history compaction as a node, realtime key minting. Scripted-model test seam — the suite runs without an API key. |
| [`@pattern/mod-docs`](./packages/mod-docs) | **Self-reflecting docs** at `/docs`: every installed mod contributes a markdown chapter shipped in its own package (version-locked), the op reference is generated from the live registry merged with per-op prose, ` ```workflow ` fences render as real graphs, ⌘K search, and `/docs/llms.txt` for agent readers. |
| [`@pattern/mod-chat`](./packages/mod-chat) | A complete chat **product app** at `/chat`: streaming transcript with the strand (tool buds, approvals, error cards), image input, Stop, refresh-recovery from the persisted turn log — and the turn pipeline is a workflow you can fork. |
| [`@pattern/mod-sample`](./packages/mod-sample) | A sample mod proving the extension surface: a Tier-1 page + ⌘K command + a Tier-2 ESM remote, added with zero admin-core changes. |
| [`create-pattern`](./packages/create-pattern) | The scaffolder (`npm create pattern`). Modpacks per use case — `studio` (admin), `agent-chat` (AI chat with tools), `headless`, `blank` — plus an auth toggle (identity + magic-link; studio defaults to locked), each shipping AGENTS.md/CLAUDE.md for coding agents. |

## Docs

- [Concepts](./docs/concepts.md) — ports, edges, the scheduler, boundaries, hooks vs events, auth.
- [Projects & mods](./docs/projects-and-mods.md) — `pattern.config.json`, declarative HTTP routes, runtime-modifiable workflows, the mod system.
- [Op catalog](./docs/op-catalog.md) — every base op, grouped, with ports & config.
- [Authoring ops & mods](./docs/authoring-ops.md) — write your own ops, boundaries, and plugins.
- [Identity](./docs/identity.md) — users, sessions, roles, login methods, the `user` port, WS session rooms.
- [The spec](./pattern-engine-spec.md) — the full design of record.

## CLI

```bash
pattern graph workflow.json      # render a workflow's graph in the terminal
pattern validate workflow.json   # validate, with located, human-readable errors
pattern dev [entry]              # run an entry with file-watch hot-reload
```

## Develop

```bash
pnpm install
pnpm build         # build all packages
pnpm test          # scheduler, streams, boundaries, hooks, auth, workers, projects, admin, SPA, security
pnpm typecheck
```

## Local testing with Verdaccio

Publish the packages to a local [Verdaccio](https://verdaccio.org) registry and
exercise the scaffolder exactly as a user would.

```bash
npx verdaccio                                    # start the registry (:4873)
npm adduser --registry http://localhost:4873     # one-time login (any creds)

pnpm local:publish                               # bump patch, build, publish all packages
pnpm local:test-create                           # scaffold + install + run against Verdaccio
```

- `pnpm local:publish` keeps the packages in lockstep and bumps within
  `0.1.x` so the templates' `^0.1.0` deps resolve to what you just published.
  Flags: `--set <version>`, `--no-bump`, `--dry-run`.
- `pnpm local:test-create` scaffolds into a temp dir, installs the published
  `@pattern/*`, and runs it. Flags: `--template <id>`, `--keep`, `--no-run`.
- Override the registry with `VERDACCIO_REGISTRY=http://host:port`.

## Status

v1 of the **execution engine**, its **Node adapter**, the **scaffolder**, and the
**admin mod** (control plane, versioned store, glassmorphism SPA with graph
editor, run replay-on-canvas, undo/redo, and the Tier-1/Tier-2 extension
surface). Storage sits on [flystorage](https://flystorage.dev), so S3/GCS/Azure
adapters drop in. The worker pool loads mods via `WorkerPoolTransport({ mods })`.
Designed-for-but-not-built (no architectural blockers): durable/resumable runs
and distributed execution behind the same `RunTransport`. See
[§13 of the spec](./pattern-engine-spec.md).

## License

MIT
