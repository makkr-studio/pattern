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

The sidebar has six sections, top to bottom. Mods add their pages to the same
sections (a mod with a product surface of its own, like chat, gets its own room).

| Section | What |
|-------|------|
| **Home** | The setup board — every installed mod's checklist ("from zero to your first subscription") ticking itself live — then the morning glance: runs and errors in the window, recent failures one click from their run, users and paying customers when those mods are present. |
| **Workflows** | The catalog. A workflow opens as a **workspace** with four tabs: **Editor** (the canvas), **Runs** (its runs only), **Versions** (snapshots, diffs, restore), **Settings** (name, tags, durable/offload, deploy/undeploy, fork, export, delete). The header states the deployment truth in one strip — *Unsaved changes · Saved v8 · Live v7* — and **Deploy** previews what changes (routes, auth gates, external-effect nodes, flags) before anything moves. Every workflow you open stays open in the strip above, with its unsaved draft, until you close it. |
| **Activity** | **Runs** across all workflows with a per-node timeline: when each node ran (sub-millisecond), what flowed through it (sampled I/O, secrets masked), linked sub-runs for tool calls. A streaming run reads honestly as **"ready in X · streamed Y"**; an offloaded run carries a **worker:N** badge. **Replay** steps a finished run on the graph as an ordered event log (hover any edge to see what crossed it). **Metrics** and **Process** show throughput, error rates, host vitals, and the run transport. |
| **Resources** | What your workflows use: data collections and blobs (mod-store), vectors, secrets (the vault), email accounts, AI providers. |
| **Administration** | People and money: users, invites, sessions, API tokens (mod-identity), billing (mod-billing), and the runtime **Settings** (observability knobs, mod settings sections). |
| **Reference** | What's installed: every **op** with ports and config schema and which workflows use it, every **mod** and what it contributes, and the **System map** (derived routes and conflicts, schedules, hook chains, events, WebSocket rooms). |

Inside the editor: the op **palette** collapses to an icon rail when you want the
canvas; the right dock is shared by the **Inspector** (the selected node — or,
with nothing selected, the workflow's own settings) and **Buddy**, one tab over.

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
  so by default the admin **refuses every request** (401, with a body naming
  the fix) and the host **warns loudly on every boot**. A missing provider mod
  never silently opens the control plane. For local work with no sign-in at
  all, opt in explicitly — `"auth": { "unenforced": "open" }` in
  `pattern.config.json` (what `create-pattern --no-auth` writes) — and the
  admin serves open, still with the boot warning.
- **Add `@pattern-js/mod-identity`** (+ a login method like
  `@pattern-js/mod-auth-magic-link`) → the *same* declaration is now enforced, the
  first boot prints a one-time bootstrap link that creates the first admin, and a
  logged-out browser is redirected to `/auth/login`. **You reconfigure nothing**:
  the admin's routes are code-derived each boot; adding the mod and restarting
  is all it takes.

Pass `auth: false` to `adminMod` for an intentionally-public admin (silences the
warning); `auth: { scopes: [...] }` to require a different scope. See
[Identity & auth](identity.md).
