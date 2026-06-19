---
title: Getting started
order: 2
---

# Getting started

Pattern installs from npm. The fastest path to something running is the
scaffolder — it sets up a project, installs the engine, and (in the `studio`
pack) gives you a visual admin to author and run workflows.

## 1. Scaffold a project

```bash
npm create pattern@latest
```

Answer the prompts (or skip them with flags). For your first project pick the
**`studio`** modpack — the engine plus the visual admin at `/admin`:

```bash
# non-interactive equivalent:
npm create pattern my-app -- --modpack studio
```

| Modpack | What you get |
|---------|--------------|
| `blank` | The engine + one example workflow. No server. |
| `headless` | Engine + an HTTP host. API-first, no UI. |
| `studio` | Engine + the **admin** (visual editor, runs, catalog) at `/admin`. |
| `agentic` | studio + agents + an OpenAI provider — an `/ask` endpoint. |
| `agent-chat` | studio + the full **chat app** at `/chat`. |

## 2. Run it

```bash
cd my-app
npm install        # if you didn't let the scaffolder install
npm run dev        # = pattern dev src/index.ts — watches & restarts on change
```

Open **http://localhost:3000/admin**. The studio pack seeds a few example
workflows into the local store on first boot, so the catalog isn't empty.

## 3. Run your first workflow

In the admin: open the **Catalog**, pick the seeded `hello` workflow, open it in
the editor, and hit **Run** (a manual trigger lets you type an input). Watch the
run appear in **Runs** — a per-node waterfall with sampled I/O you can peek, and
an on-canvas replay that animates the execution.

That workflow is just this — three nodes wired by their ports:

```workflow
{
  "id": "hello",
  "name": "Hello, Pattern",
  "nodes": [
    { "id": "in",    "op": "boundary.manual", "config": { "outputs": ["name"] } },
    { "id": "greet", "op": "core.string.template", "config": { "template": "Hello, {{ name }}! 👋" } },
    { "id": "out",   "op": "boundary.return" }
  ],
  "edges": [
    { "from": { "node": "in",    "port": "name" }, "to": { "node": "greet", "port": "data"  } },
    { "from": { "node": "greet", "port": "out"  }, "to": { "node": "out",   "port": "value" } }
  ]
}
```

The trigger (`boundary.manual`) seeds the `name` input; `core.string.template`
interpolates it; `boundary.return` hands the result back. Edit the template,
**Deploy** the new version, and run it again — versioning and instant rollback
are built in.

## 4. Where to go next

You now have a running engine. Pick the path that matches what you're building:

- **Understand the model** — [Concepts](concepts.md): ports, the three edge
  kinds, the scheduler, boundaries, hooks, auth.
- **Author workflows** — [in the admin](guides/workflow-in-the-admin.md) (visual)
  or [in JSON](guides/workflow-in-json.md) (by hand, hot-reloaded).
- **Build an HTTP API** — [Create an app](guides/creating-an-app.md) and
  [Designing your API](guides/designing-your-api.md).
- **Add your own logic** — [Authoring ops](guides/authoring-ops.md).
- **Serve a frontend** — [Frontend app with workflows](guides/frontend-app-with-workflows.md).
- **Go further** — [Agents & chat](guides/agents-and-chat.md),
  [Identity](guides/identity.md), or build a
  [third-party mod](guides/creating-a-mod.md).

> No API key needed for the basics. The agent packs read `OPENAI_API_KEY` from a
> `.env` next to `pattern.config.json` (loaded automatically on boot).
