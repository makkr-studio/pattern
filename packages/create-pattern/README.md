# create-pattern

The scaffolder for [Pattern](../../README.md) projects — the front door of the DX.

```bash
npm create pattern@latest
# or
pnpm create pattern my-app --modpack studio
```

Projects are scaffolded from **modpacks** — curated sets of mods for a use
case. Interactive by default — banner → modpack → auth/docs/examples toggles →
"what's in the box" card → package manager → install + git init → tailored
next steps. Degrades gracefully in non-TTY/CI: fully flag-driven, no prompts,
no animation.

## App or mod?

The first question is **what you're creating**:

- **An app** — a runnable Pattern project (the modpack ladder below). The default.
- **A mod** — a publishable npm package that exports `defineMod(...)` and extends
  any Pattern engine with ops, routes, an admin page, and a docs chapter.

For a mod, a short questionnaire picks the pieces (ops, HTTP routes, an admin page
— Tier-1 declarative or Tier-2 custom React, and a docs chapter); the scaffold is
publishable as-is. A Tier-2 admin page is pre-wired against the admin's own stack
(React + Tailwind + motion.dev + lucide, read off the shared `__PATTERN_ADMIN__`
global — no bundler). Headless: `create-pattern my-mod --kind mod` (defaults to
ops + routes + a Tier-1 page + docs).

## Modpacks (apps)

Pick by **how much you want running** — the five sit on one ladder:

| Modpack | id | Adds over the previous rung | It's really… |
|---------|----|-----------------------------|--------------|
| **Engine only** | `blank` | — | a program, no server — run a workflow from code and watch it print |
| **Headless server** | `headless` | the HTTP/WS/CLI host | a running server, no UI — serve workflows as endpoints |
| **Studio** | `studio` | `@pattern/mod-admin` | a visual workspace at `/admin` — build, version, run & trace workflows |
| **Studio + Agents** | `agentic` | the agent stack (agents + store + vault) | build **agentic workflows** (`agents.agent` → `agents.run`, tools as workflows) in the editor — no chat UI |
| **Studio + Agentic Chat** | `agent-chat` | `@pattern/mod-chat` | a chat product at `/chat` — tools, guardrails, HITL; its turn pipeline is an agentic workflow |

Run `create-pattern --list` for the ladder, or `--dry-run` to print the exact
manifest (mods + roles, generated files, endpoints, env) for any selection
without writing anything.

**Auth & docs are dimensions, not packs**: where the pack serves HTTP, prompts
offer the identity brick (`@pattern/mod-identity` +
`@pattern/mod-auth-magic-link`) and the self-documenting `/docs` site
(`@pattern/mod-docs`). First boot prints a one-time link; the first account
becomes admin; sign-in links print to the console until you wire real delivery.
`headless` with auth also gets a protected `GET /whoami` route demoing
`requireAuth` + the trigger's `user` port.

**Examples are a dimension too** — on every pack, asked each time, **on by
default**. "Examples" means the demo *custom* content (sample workflows,
example tools, app-local demo mods); the platform mods and their built-in
workflows always run. `--no-examples` strips the demos and leaves a runnable
skeleton plus notes on how to add your own — so you don't scaffold-then-delete.

Every modpack ships **AGENTS.md + CLAUDE.md** — the contract sheet a coding
agent needs to add ops, routes, workflows, and admin pages without guessing
(paired with the `pattern ops` ground-truth catalog in the terminal).

## Flags (headless)

```
create-pattern <name> [--kind app|mod] [--modpack <id>] [--auth|--no-auth] [--docs|--no-docs] [--examples|--no-examples] [--pm npm|pnpm|yarn|bun] [--no-install] [--no-git] [--yes] [--list] [--dry-run]

# mod (--kind mod):
create-pattern <name> --kind mod [--scope @acme] [--ops|--no-ops] [--workflows|--no-workflows] [--admin none|tier1|tier2] [--docs|--no-docs]
```

`--template`/`-t` remains as an alias (legacy ids `hello-workflow`/`http-api`
map to `blank`/`headless`). `--list` prints the modpack table. Without
`--auth`/`--no-auth`, non-interactive runs use the pack's default — **studio
ships locked**. Examples default **on**; pass `--no-examples` for a clean
scaffold.
