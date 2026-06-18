---
title: The admin
order: 13
---

# The admin

`@pattern/mod-admin` is the authorable, self-reflecting **control surface**:
workflow authoring on a visual canvas, live deploy, run inspection with
per-node waterfalls, versioning with diffs, and a catalog of everything in the
system. It is a **mod** — a brick you add to the config, with no privileged
position.

```jsonc
// pattern.config.json
{ "mods": ["@pattern/mod-admin"] }
```

The UI lives at `/admin`, the workflow-backed API under `/admin/api/*`.

## It edits itself

The admin's backend is authored in the same primitives it edits: every API
route is a workflow (`http.request → admin.<op> → http.response`). The HTTP
host derives routes by scanning workflows, so the admin's own control plane
appears in its catalog — and is editable inside itself.

## The rooms

| Where | What |
|-------|------|
| **Workflows / Editor** | The canvas: drag ops from the palette, wire ports (value cyan, stream violet, control dashed), fork code workflows, deploy with route-conflict checks. |
| **Runs** | Every run with a per-node timeline — when each node ran, what flowed through it (sampled I/O, secrets masked), linked sub-runs for tool calls. |
| **Replay** | Step a finished run event-by-event on the graph. |
| **Catalog (Ops / Mods)** | Everything registered, with ports, config schemas, and which workflows use what. |
| **Metrics / Process** | Throughput, error rates, host process vitals. |
| **System** | Settings, secrets (the vault), observability knobs. |

## Mods extend the admin

A mod can contribute admin pages declaratively — menu entries + table/detail
views, each bound to a **dedicated route** the mod also ships (`frontend`
contribution). There is no generic "run any op" endpoint: every screen and
action names its own purposeful route (request → op → response), so what the
admin exposes is a readable route table, not an ACL over the whole catalog. The
Data browser (mod-store), Secrets (mod-vault), and Chat conversations (mod-chat)
pages all arrive this way. The same idea powers these docs: see
[Extending the docs](extending-the-docs.md).

## Locking it down

Add `@pattern/mod-identity` + a login method (e.g.
`@pattern/mod-auth-magic-link`) and the first boot prints a one-time bootstrap
link that creates the first admin. See [Identity & auth](identity.md).
