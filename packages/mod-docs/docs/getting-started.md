---
title: Getting started
order: 2
---

# Getting started

Pattern installs from npm. The fastest path to something running is the
scaffolder: it sets up a project, installs the engine, and (in the `studio`
pack) gives you a visual admin to author and run workflows.

## 1. Scaffold a project

```bash
npm create pattern@latest
```

Answer the prompts (or skip them with flags). For your first project pick the
**`studio`** modpack (the engine plus the visual admin at `/admin`):

```bash
# non-interactive equivalent:
npm create pattern my-app -- --modpack studio
```

| Modpack | What you get |
|---------|--------------|
| `blank` | The engine + one example workflow. No server. |
| `headless` | Engine + an HTTP host. API-first, no UI. |
| `studio` | Engine + the **admin** (visual editor, runs, catalog) at `/admin`. |
| `studio-ai` | studio + **mod-ai**: plain AI workflows (text, object, image, speech) in the editor. |
| `agentic` | studio + AI + the agent stack (agent, run, tools): an `/ask` endpoint. |
| `agent-chat` | studio + the full **chat app** at `/chat`. |
| `saas-starter` | studio + sign-in, **Stripe billing** wired to roles, a gated `/pro` page. |
| *compose* | **pick your layers** — one multiselect (or `--with admin,auth,billing,…`); every composition prints its reproducible one-liner. |

The wizard then offers the orthogonal **dimensions** — every one has a flag for
scripting (`--help` lists them all):

- **Authentication** (`--auth`): identity, users & sessions; locks the admin.
  Then pick the **sign-in methods**: magic link (zero-config, links print to
  the console in dev), OIDC (`--oidc` — Google, Microsoft, any issuer; the
  scaffold writes a `mods/oidc.mjs` to fill in), or both.
- **Sign-in link delivery** (`--email console|resend|smtp`): keep the console,
  or wire real email — mod-email plus the chosen driver; create the `default`
  account in admin → System → Email and links send themselves.
- **Docs** (`--docs`), **examples** (`--no-examples` for a clean scaffold), a
  generated **vault key**, and the **AI providers** to install (AI packs).

**Grow it later.** A scaffold isn't a final answer — inside any project,
`pattern add billing` (or `npx create-pattern add billing`) applies more
layers additively: dependencies at your project's own version, config in the
right order, and your files never overwritten. `pattern add` alone lists
every layer's status.

## 2. Run it

```bash
cd my-app
npm install        # if you didn't let the scaffolder install
npm run dev        # = pattern dev src/index.ts (watches & restarts on change)
```

Open **http://localhost:3000/admin**. The studio modpack seeds a few example
workflows into the local store on first boot, so the catalog isn't empty.

## 3. Run your first workflow

In the admin: open the **Catalog**, pick the seeded `hello` workflow, open it in
the editor, and hit **Run** (a manual trigger lets you type an input). Watch the
run appear in **Runs**: a per-node waterfall with sampled I/O you can peek, and
an on-canvas replay that animates the execution.

That workflow is three nodes wired by their ports:

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
**Deploy** the new version, and run it again. Versioning and instant rollback
are built in.

## 4. Where to go next

You now have a running engine. Pick the path that matches what you're building:

- **Build with Buddy** (agent packs): the ✦ toggle in the editor toolbar opens
  the assistant — describe a workflow and it drafts it onto your canvas,
  validated; you keep Save and Deploy. The same tools reach your own editor's
  agent: the scaffold's `.mcp.json` wires `pattern mcp`, so Claude Code or
  Cursor can list ops, read docs, validate and save drafts directly.
- **Understand the model** with [Concepts](concepts.md): ports, the three edge
  kinds, the scheduler, boundaries, hooks, auth.
- **Author workflows** [in the admin](guides/workflow-in-the-admin.md) (visual)
  or [in JSON](guides/workflow-in-json.md) (by hand, hot-reloaded).
- **Build an HTTP API** with [Create an app](guides/creating-an-app.md) and
  [Designing your API](guides/designing-your-api.md).
- **Add your own logic** with [Authoring ops](guides/authoring-ops.md).
- **Serve a frontend** with [Frontend app with workflows](guides/frontend-app-with-workflows.md).
- **Go further**: [Agents & chat](guides/agents-and-chat.md),
  [Identity](guides/identity.md), or build a
  [third-party mod](guides/creating-a-mod.md).
- **Ship it** with [Deploying](guides/deploying.md): every scaffold carries a
  Dockerfile — two volumes and a `PATTERN_PUBLIC_URL` and you're live.

> No API key needed for the basics. When you add a model, mod-ai resolves a
> provider key (e.g. `OPENAI_API_KEY` for OpenAI) from a `.env` next to
> `pattern.config.json`, or from the vault.
