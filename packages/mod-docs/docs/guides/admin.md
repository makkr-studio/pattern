---
title: The admin
order: 13
---

# The admin

`@pattern-js/mod-admin` is the authorable, self-reflecting **control surface**:
workflow authoring on a visual canvas, live deploy, run inspection with
per-node waterfalls, versioning with diffs, and a catalog of everything in the
system. It is a **mod**: a brick you add to the config, with no privileged
position.

```jsonc
// pattern.config.json
{ "mods": ["@pattern-js/mod-admin"] }
```

The UI lives at `/admin`, the workflow-backed API under `/admin/api/*`.

## It edits itself

The admin's backend is authored in the same primitives it edits: every API
route is a workflow (`http.request → admin.<op> → http.response`). The HTTP
host derives routes by scanning workflows, so the admin's own control plane
appears in its catalog and is editable inside itself.

## The rooms

| Where | What |
|-------|------|
| **Workflows / Editor** | The canvas: drag ops from the palette, wire ports (value cyan, stream violet, control dashed), fork code workflows, deploy with route-conflict checks. |
| **Runs** | Every run with a per-node timeline: when each node ran (sub-millisecond), what flowed through it (sampled I/O, secrets masked), linked sub-runs for tool calls. A streaming run reads honestly as **"ready in X · streamed Y"** (time-to-first-byte vs. time-to-last-token); an offloaded run carries a **worker:N** badge. |
| **Replay** | Step a finished run on the graph as an ordered **event log**: each node's start, every value output, and (with I/O sampling on) **every stream chunk** are discrete steps on a real-time track ticked at each event. Stepping is symmetric (forward-N then back-N returns home); **hover any edge** to see the value (or the current token) that crossed it. |
| **Catalog (Ops / Mods)** | Everything registered, with ports, config schemas, and which workflows use what. |
| **Metrics / Process** | Throughput, error rates, host process vitals, the run transport (inline + any worker pool). |
| **System** | Settings, secrets (the vault), observability knobs (I/O sampling, retention). |

The trace separates a run's **result-ready** moment (its outputs are available: the
`RunResult` resolves and the HTTP response starts) from its **true end** (all
streams drained). That's why a chat turn that streams for seconds no longer reads
as a few milliseconds. A run is **independent of the client connection**: if the
browser drops mid-stream the turn keeps running and persisting, and replays on
reconnect. Set `cancelOnDisconnect` on the request trigger to stop a
pure passthrough stream when its client leaves. Offloaded (`offload`) runs
execute on a worker but their full trace is forwarded back, so they appear here
exactly like inline ones.

Runs are recorded to a **durable trace store** (SQLite at `.pattern/traces.db`
by default), so they survive restarts and any process writing that DB shows up:
a `pattern run` CLI invocation lands in the same Runs list as the host's. It's
behind an abstraction (`TraceStore`), so the backend can be swapped later; set
`trace: { persist: false }` in `pattern.config.json` to keep it in-memory
(ephemeral), and it degrades to in-memory automatically when `node:sqlite` is
unavailable.

## Mods extend the admin

A mod can contribute admin pages declaratively: menu entries + table/detail
views, each bound to a **dedicated route** the mod also ships (`frontend`
contribution). There is no generic "run any op" endpoint: every screen and
action names its own purposeful route (request → op → response), so what the
admin exposes is a readable route table. The
Data browser (mod-store), Secrets (mod-vault), and Chat conversations (mod-chat)
pages all arrive this way. The same idea powers these docs: see
[Extending the docs](extending-the-docs.md).

**Fully-custom pages, no workflow.** Beyond the declarative views, a mod can ship
a **fully-custom React page** as `module` source: the ESM string of a component
that reads React, the API client, and the glass UI kit off the shared
`__PATTERN_ADMIN__` global (one React, no bundler). The admin serves that source
from its own same-origin route and `import()`s it, so a custom page needs **no
workflow, no asset mount, and no CSP relaxation** (a plain `script-src 'self'`
covers it). mod-ai's "AI Providers" page works exactly this way. Serving a whole
*app* (its own SPA) is the separate, unchanged story: a `boundary.http.app`
workflow.

**Page chrome is yours to control.** Each `pages[]` entry may set `title` and
`subtitle` (the shell's header defaults to the menu label + a generic line), or
`header: false` to suppress the shell header entirely and let a custom page
render its own, so a polished page never shows a doubled title.

## Locking it down

The admin **always declares** `requireAuth: { scopes: ["admin"] }` on its API +
SPA; the requirement is built in and stays constant across setups. Whether it's
*enforced* depends on an auth provider:

- **No provider** → the requirement can't be enforced (nobody can authenticate),
  so the admin serves **advisory-open** and the host **warns loudly on every
  boot**. Good for local work; the boot warning keeps it from being silently
  exposed.
- **Add `@pattern-js/mod-identity`** (+ a login method like
  `@pattern-js/mod-auth-magic-link`) → the *same* declaration is now enforced, the
  first boot prints a one-time bootstrap link that creates the first admin, and a
  logged-out browser is redirected to `/auth/login`. **You reconfigure nothing**:
  the admin's routes are code-derived each boot; adding the mod and restarting
  is all it takes.

Pass `auth: false` to `adminMod` for an intentionally-public admin (silences the
warning); `auth: { scopes: [...] }` to require a different scope. See
[Identity & auth](identity.md).
