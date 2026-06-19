---
title: Author a workflow in the admin
order: 8
---

# Author a workflow in the admin

The admin (`@pattern/mod-admin`, in the `studio` pack and up) is a visual editor
for the same JSON workflows you can write by hand — but with a live op palette,
typed connection assist, validation, one-click deploy, and run replay. This is
the fastest way to build and watch a workflow.

> Prerequisite: a running studio project (`npm create pattern my-app -- --modpack
> studio`, then `npm run dev`) open at **http://localhost:3000/admin**. See
> [Getting started](../getting-started.md).

## 1. New workflow

From the **Catalog**, choose **New** (or start from a **Template** — auth-gated
endpoint, SSE stream, cron, …). You land in the graph editor with an empty canvas.

## 2. Drop a trigger and ops

Open the **palette** (every registered op, grouped by area, searchable) and drag
ops onto the canvas. Each becomes a **node** rendered from its op definition — its
input ports on the left, output ports on the right, control ports top/bottom.

Start with a trigger:

- **`boundary.manual`** — fire it by hand from the editor (great for iterating).
- **`boundary.http.request`** — an HTTP route; its method/path/CORS/auth live in
  the node's config.

Then add the ops that do the work — e.g. `core.string.template`,
`core.object.get`, `core.http.fetch` — and an out-gate (`boundary.return` for a
manual flow, `boundary.http.response` for an HTTP one).

## 3. Wire the ports

Drag from an output port to an input port. The editor knows the
[three edge kinds](../concepts.md#ports-and-the-three-edge-kinds) and the schemas,
so **connection assist** lights up only compatible targets; if you aim at an
incompatible one it explains why ("stream→value: insert `core.stream.accumulate`")
and offers a one-click adapter. Edge colour shows the kind — value solid, stream
animated, control dotted.

## 4. Configure nodes

Select a node to open its **config inspector** — a form generated from the op's
config schema (Zod → JSON Schema). Secret-typed fields render masked. The trigger
is where declarative facts live: an HTTP route's path/method/validation, a
schedule's cron, an app's mount.

## 5. Validate, save, deploy

The editor runs the **same `collectIssues` validation the engine runs** as you
edit — problems mark the offending node/port and collect in a Problems panel.
When it's clean:

- **Save** mints an immutable version (a full JSON snapshot).
- **Deploy** makes that version *live*. If its HTTP route conflicts with another
  live workflow, the admin doesn't guess — it offers **cancel** or **swap**.

Enable/disable is control-plane state: a disabled workflow stays in the store but
isn't registered.

## 6. Run it and watch

Hit **Run** (a manual trigger lets you type the input; an HTTP trigger can be
simulated from its schema). Then open **Runs**:

- a per-node **waterfall** with timing and status,
- **sampled I/O** you can peek (secrets masked),
- linked **sub-runs** for tool calls / `ctx.invoke`,
- **replay** that animates the run over the canvas, pulsing nodes
  pending→running→ok|error and illuminating edges as they carry data.

## 7. Version, diff, roll back

**Versions** lists every snapshot with a structural **JSON diff** between any two.
Promote or roll back with a single pointer move — rollback is instant and leaves
in-flight runs untouched. Every promote/rollback is recorded in the audit trail.

## Export to a file

Authored visually but want it in your repo? Export the workflow JSON and drop it
into `workflows/` — it's the exact same document. The reverse works too: file
workflows show up in the catalog (as read-only `code`/`file` source) and can be
**forked** into an editable copy. See [Author a workflow in JSON](workflow-in-json.md).
