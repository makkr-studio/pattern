---
title: {{Title}}
order: 50
---

# {{Title}}

`{{pkgName}}` is a Pattern mod. This chapter ships inside the package, so it joins
the handbook at `/docs` whenever the mod is installed, and disappears when it's
removed.

## What it contributes

- **An op**: `{{opPrefix}}.items.list` (the example; replace it with your real
  logic). See it in the catalog: `npx pattern ops {{opPrefix}}`.
- **A route**: `GET /api/{{name}}/items`, fronting the pure op.
- **An admin page**: under *Extensions* in the admin (if you scaffolded one).

## Install

Add it to a project's `pattern.config.json`:

```jsonc
{ "mods": ["{{pkgName}}"] }
```

## Where to look

- `src/ops.ts`: the op (pure logic).
- `src/routes.ts`: the route(s) fronting it.
- `src/frontend.ts` / `src/app.ts`: the admin page.
- `AGENTS.md`: the mod-authoring guide your coding agent reads.

Files under `docs/ops/<op.type>.md` (like `docs/ops/{{opPrefix}}.items.list.md`)
become the "when to use" prose in the generated op reference.
