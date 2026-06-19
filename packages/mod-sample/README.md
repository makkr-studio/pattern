# @pattern/mod-sample

The in-repo example mod for [Pattern](../../README.md) — read it to learn the mod
contract end to end. It extends the admin with a **Tier-1 declarative page**, a
**⌘K command**, and a **Tier-2 ESM remote** with **zero admin-core changes**. If
the admin renders all of it untouched, the extension surface works. The whole
thing is one file: `src/index.ts`.

This package is `private` — it ships as a worked example, not a dependency.

## When to use

Don't install it in a real app; read it. It's the reference for what a mod can
contribute: `ops` (pure graph nodes), `workflows` (routes + demos registered at
boot), a declarative `frontend` block (data, not React), `docs`, and a
`setup(engine)` that registers filesystems and services — all handed to
`defineMod`.

## Config

To see it live in a dev project, add it as a string in `pattern.config.json`:

```jsonc
{ "mods": ["@pattern/mod-sample"] }
```

It mounts a Tier-2 bundle under `/ext` and adds an "Examples → Greetings" admin
page reading a purposeful `/admin/api/sample/greetings` route.

Full documentation: the **Sample — anatomy of a mod** chapter at `/docs` (served
by `@pattern/mod-docs`), or [the source](docs/index.md). To build your own, see
[Create a third-party mod](../mod-docs/docs/guides/creating-a-mod.md).
