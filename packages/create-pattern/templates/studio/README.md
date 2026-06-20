# {{name}}

A [Pattern](https://github.com/) project with the **studio** modpack: the
workflow engine plus `@pattern-js/mod-admin` — a visual control plane that edits,
versions, runs, and observes the very workflows serving your traffic.

```bash
npm run dev          # hot-reload (pattern dev)
# then open
#   http://localhost:3000/admin
# and try the seeded endpoints
curl localhost:3000/hello/world
curl localhost:3000/quote
```

## What's inside

```
{{name}}/
  pattern.config.json    # mods to load: the admin + your app-local mod
  mods/
    quotes.mjs           # app-local mod: 2 ops + an admin page + a ⌘K command
  workflows/             # file-based workflows (read-only in the admin)
  src/
    index.ts             # loadProject() → start()
    examples.ts          # first-boot seed: 3 editable example workflows
  .pattern/              # the admin's workflow store (versions, audit) — commit it
  AGENTS.md              # docs for your coding agent (CLAUDE.md points here)
```

## The five-minute tour

1. **Workflows** — `hello`, `quote`, `showcase` are live and editable.
2. **Editor** — open `hello`, move nodes, change the template, **Save → Deploy**.
   `curl localhost:3000/hello/world` reflects it immediately; **Versions** shows
   the colored diff and one-click rollback.
3. **Run** `showcase` from the editor ▶, then open **Runs**: the waterfall
   separates the idle 800ms wait from the CPU-bound fibonacci; **Replay** steps
   the graph through time.
4. **Examples → Quotes** in the menu — that page is contributed by
   `mods/quotes.mjs`: a JSON-declared table, no build step, admin untouched.
5. **Ops** — the living catalog of everything you can wire, including your
   `app.quotes.*` ops. Same truth in the terminal: `npx pattern ops`.

## Where workflows live

- **Admin-authored** → `./.pattern` (versioned store, the admin's source of
  truth). Commit it — it is your deployable state.
- **File-based** → `workflows/*.json`, registered at boot, read-only in the
  admin (fork to make an editable copy).
- Examples reseed only into an **empty** store: delete `./.pattern` to factory
  reset.

## Extending

`AGENTS.md` is the contract sheet — point your coding agent at it (Claude Code
reads it via `CLAUDE.md`) and ask for a new op, route, or admin page. The short
version: ops go in `mods/`, routes are declared inside workflows (no route
table), and admin pages are a `frontend` block in your mod.
