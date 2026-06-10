# create-pattern

The scaffolder for [Pattern](../../README.md) projects — the front door of the DX.

```bash
npm create pattern@latest
# or
pnpm create pattern my-app --modpack studio
```

Projects are scaffolded from **modpacks** — curated sets of mods for a use
case. Interactive by default — banner → modpack (with a "what's in the box"
card) → package manager → install + git init → tailored next steps. Degrades
gracefully in non-TTY/CI: fully flag-driven, no prompts, no animation.

## Modpacks

| Modpack | Mods | What |
|---------|------|------|
| `studio` | `@pattern/mod-admin` + an app-local mod | the engine wearing its visual admin: editor, versions, runs, replay — plus seeded editable examples and a mod that extends the admin with a page |
| `headless` | an app-local mod | a declarative HTTP backend: routes as workflow JSON, schema validation, env interpolation, no UI |
| `blank` | none | the smallest possible Pattern program: one workflow, one `engine.run()` |

Every modpack ships **AGENTS.md + CLAUDE.md** — the contract sheet a coding
agent needs to add ops, routes, workflows, and admin pages without guessing
(paired with the `pattern ops` ground-truth catalog in the terminal).

## Flags (headless)

```
create-pattern <name> [--modpack <id>] [--pm npm|pnpm|yarn|bun] [--no-install] [--no-git] [--yes] [--list]
```

`--template`/`-t` remains as an alias (legacy ids `hello-workflow`/`http-api`
map to `blank`/`headless`). `--list` prints the modpack table.
