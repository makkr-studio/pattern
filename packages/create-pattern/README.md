# create-pattern

The scaffolder for [Pattern](https://pattern-js.dev) projects: the front door of the DX.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/create-pattern)

```bash
npm create pattern@latest
# or
pnpm create pattern my-app --modpack studio
```

Projects are scaffolded from **modpacks**: curated sets of mods for a use
case. Interactive by default: banner → modpack → auth/docs/examples toggles →
"what's in the box" card → package manager → install + git init → tailored
next steps. Degrades gracefully in non-TTY/CI: fully flag-driven, no prompts,
no animation.

## App or mod?

The first question is **what you're creating**:

- **An app**: a runnable Pattern project (the modpack ladder below). The default.
- **A mod**: a publishable npm package that exports `defineMod(...)` and extends
  any Pattern engine with ops, routes, an admin page, and a docs chapter.

For a mod, a short questionnaire picks the pieces (ops, HTTP routes, an admin page
that is Tier-1 declarative or Tier-2 custom React, and a docs chapter); the
scaffold is publishable as-is. A Tier-2 admin page is pre-wired against the
admin's own stack (React + Tailwind + motion.dev + lucide, read off the shared
`__PATTERN_ADMIN__` global, no bundler). Headless: `create-pattern my-mod --kind
mod` (defaults to ops + routes + a Tier-1 page + docs).

## Modpacks (apps)

Pick by **how much you want running**. The six sit on one ladder:

| Modpack | id | Adds over the previous rung | It's really… |
|---------|----|-----------------------------|--------------|
| **Engine only** | `blank` | (base) | a program, no server: run a workflow from code and watch it print |
| **Headless server** | `headless` | the HTTP/WS/CLI host | a running server, no UI: serve workflows as endpoints |
| **Studio** | `studio` | `@pattern-js/mod-admin` | a visual workspace at `/admin`: build, version, run & trace workflows |
| **SaaS starter** | `saas-starter` | identity + `@pattern-js/mod-billing` (+ Stripe driver, email, store) | a **subscription SaaS**: sign in, subscribe via Stripe checkout, and a `/pro` area gated by a scope the webhook grants |
| **Studio + AI** | `studio-ai` | `@pattern-js/mod-ai` (+ vectors, store, vault) | plain **AI workflows** (text · object · image · speech) in the editor, no agent loop |
| **Studio + Agents** | `agentic` | the agent stack (agents + Buddy) | build **agentic workflows** (`agents.agent` → `agents.run`, tools as workflows) in the editor, no chat UI |
| **Studio + Agentic Chat** | `agent-chat` | `@pattern-js/mod-chat` | a chat product at `/chat`: tools, guardrails, HITL; its turn pipeline is an agentic workflow |

Run `create-pattern --list` for the ladder, or `--dry-run` to print the exact
manifest (mods + roles, generated files, endpoints, env) for any selection
without writing anything.

**Auth & docs are dimensions that layer onto any pack**: where the pack serves HTTP, prompts
offer the identity brick (`@pattern-js/mod-identity` +
`@pattern-js/mod-auth-magic-link`) and the self-documenting `/docs` site
(`@pattern-js/mod-docs`). First boot prints a one-time link; the first account
becomes admin; sign-in links print to the console until you wire real delivery.
`headless` with auth also gets a protected `GET /whoami` route demoing
`requireAuth` + the trigger's `user` port.

**Examples are a dimension too**: on every pack, asked each time, **on by
default**. "Examples" means the demo *custom* content (sample workflows,
example tools, app-local demo mods); the platform mods and their built-in
workflows always run. `--no-examples` strips the demos and leaves a runnable
skeleton plus notes on how to add your own, so you don't scaffold-then-delete.

**The AI packs work on first boot.** Picking a provider (`--providers openai`)
doesn't just install its `@ai-sdk` package — it **seeds the model aliases** the
platform resolves by name: `default` (language) and, when the provider has one,
`embeddings` (embedding) land in `.pattern-data/ai-config.json`, each reading
its key from `.env` via an env-sourced secret *reference* (no value is ever
written). Set the key and agents, `/rag/*`, and Buddy all answer — re-point the
aliases anytime in admin → Settings → AI Providers. The Buddy packs (`agentic`,
`agent-chat`) also scaffold **`.mcp.json`** wiring `npx pattern mcp`, so opening
the project in Claude Code connects the `pattern_*` control-plane tools (ops,
docs, validate, drafts, runs) with zero setup. And `agentic` with Resend email
delivery ships the inbound demo: `workflows/email-agent-reply.json` —
`email.inbound` → agent → threaded `email.reply`.

Every modpack ships **AGENTS.md + CLAUDE.md**: the contract sheet a coding
agent needs to add ops, routes, workflows, and admin pages without guessing
(paired with the `pattern ops` ground-truth catalog in the terminal).

## Compose your own (`--with`)

The picker's last entry — and the packs' general case. Instead of a curated
pack, pick capability **layers** in one multiselect, answer sub-questions only
for what you picked, and the scaffolder assembles the stack:

```bash
npm create pattern@latest my-app -- --with admin,auth:magic-link,email:resend,billing
```

Layers: `admin` · `auth[:magic-link|oidc|both]` · `email[:console|resend|smtp]`
· `ai` · `agents` · `chat` · `vectors` · `billing` · `buddy` · `docs`.
Dependencies pull in automatically **with a printed note** — `--with chat`
tells you it brought agents, AI, store and vault along. Every layer seeds its
own example workflows (billing brings the checkout/portal/`/pro` surface,
vectors the RAG pair, agents the `/ask` demo), documents itself in AGENTS.md,
and known pairs unlock recipes (agents + Resend email → the inbound
email-answering agent). The scaffold ends by printing the **reproducible
one-liner** for the exact composition — share it, script it, or hand it to a
coding agent. `--dry-run --with …` previews the manifest without writing.

The packs above are curated presets over the same machinery: reach for a rung
for a quick demo, compose when you know what you want.

## Flags (headless)

```
create-pattern <name> [--kind app|mod] [--modpack <id>] [--with <layers>] [--auth|--no-auth] [--docs|--no-docs] [--examples|--no-examples] [--pm npm|pnpm|yarn|bun] [--no-install] [--no-git] [--yes] [--list] [--dry-run]

# mod (--kind mod):
create-pattern <name> --kind mod [--scope @acme] [--ops|--no-ops] [--workflows|--no-workflows] [--admin none|tier1|tier2] [--docs|--no-docs]
```

`--template`/`-t` remains as an alias (legacy ids `hello-workflow`/`http-api`
map to `blank`/`headless`). `--list` prints the modpack table. Without
`--auth`/`--no-auth`, non-interactive runs use the pack's default (**studio
ships locked**). Examples default **on**; pass `--no-examples` for a clean
scaffold.
