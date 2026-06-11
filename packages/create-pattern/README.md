# create-pattern

The scaffolder for [Pattern](../../README.md) projects — the front door of the DX.

```bash
npm create pattern@latest
# or
pnpm create pattern my-app --modpack studio
```

Projects are scaffolded from **modpacks** — curated sets of mods for a use
case. Interactive by default — banner → modpack → auth toggle (where it makes
sense) → "what's in the box" card → package manager → install + git init →
tailored next steps. Degrades gracefully in non-TTY/CI: fully flag-driven,
no prompts, no animation.

## Modpacks

| Modpack | Mods | Auth default | What |
|---------|------|--------------|------|
| `studio` | `@pattern/mod-admin` + an app-local mod | **on** | the engine wearing its visual admin: editor, versions, runs, replay — plus seeded editable examples and a mod that extends the admin with a page |
| `headless` | an app-local mod | off | a declarative HTTP backend: routes as workflow JSON, schema validation, env interpolation, no UI |
| `blank` | none | — | the smallest possible Pattern program: one workflow, one `engine.run()` |

**Auth is a dimension, not a pack**: where the pack serves HTTP, a second
prompt offers the identity brick (`@pattern/mod-identity` +
`@pattern/mod-auth-magic-link`) — magic-link login, users & sessions, and a
secured admin. First boot prints a one-time link; the first account becomes
admin; sign-in links print to the console until you wire real delivery.
`headless` with auth also gets a protected `GET /whoami` route demoing
`requireAuth` + the trigger's `user` port. `blank` is never asked (no HTTP
host).

Every modpack ships **AGENTS.md + CLAUDE.md** — the contract sheet a coding
agent needs to add ops, routes, workflows, and admin pages without guessing
(paired with the `pattern ops` ground-truth catalog in the terminal).

## Flags (headless)

```
create-pattern <name> [--modpack <id>] [--auth|--no-auth] [--pm npm|pnpm|yarn|bun] [--no-install] [--no-git] [--yes] [--list]
```

`--template`/`-t` remains as an alias (legacy ids `hello-workflow`/`http-api`
map to `blank`/`headless`). `--list` prints the modpack table. Without
`--auth`/`--no-auth`, non-interactive runs use the pack's default — **studio
ships locked**.
