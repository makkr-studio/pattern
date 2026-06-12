---
title: Extending these docs
order: 16
---

# Extending these docs

This documentation is itself a mod (`@pattern/mod-docs`) — and **any mod can
contribute a chapter**, first-party or third-party. Install a mod, its docs
appear in the sidebar; uninstall it, they're gone. Content ships *inside* the
npm package, so what you read always matches the version you run.

## Ship a chapter in three steps

**1. Put markdown in your package.** A `docs/` folder next to your `dist/`:

```
my-mod/
  docs/
    index.md            # the chapter landing page
    guides/setup.md     # any structure you like
    ops/my.op.md        # per-op prose (see below)
  dist/
  package.json          # "files": ["dist", "docs"]
```

**2. Register it as a filesystem** in your mod's `setup` (the same move every
app mod makes for its SPA assets):

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern/runtime-node";

setup(engine) {
  const dir = fileURLToPath(new URL("../../docs", import.meta.url));
  if (existsSync(dir)) provideFilesystem(engine, "my-mod-docs", localFs(dir));
}
```

**3. Point your mod at it** with the `docs` field:

```ts
export default defineMod({
  name: "my-mod",
  docs: { filesystem: "my-mod-docs", title: "My Mod", order: 50 },
  // …ops, workflows, setup…
});
```

That's the whole contract. The docs host aggregates every installed mod's
contribution via `engine.docs()`.

## Nav is derived from frontmatter

You don't declare navigation — every `*.md` outside `ops/` becomes a page:

```markdown
---
title: Getting set up
order: 10
---

# Getting set up
…
```

Title falls back to the first `# heading`, then the filename; pages sort by
`order` (default 100), then label. Files in a subdirectory (`guides/…`) group
under that directory's name. Prefer explicit control? Pass `nav: [...]` in the
contribution and it wins.

## Per-op prose

Files under `ops/` are special: `ops/<op.type>.md` (e.g. `ops/my.op.md`) never
becomes a nav page — it's merged into the **generated op reference** as the
"when to use" prose above the live port/config tables. Write the why; the
docs render the what from the running registry.

## Live workflow embeds

A fenced block with the `workflow` language renders as a real, read-only
graph — the same renderer the admin uses:

````markdown
```workflow
{ "nodes": [...], "edges": [...] }
```
````

Paste a workflow JSON (export one from the admin editor) and your guide shows
a living canvas instead of a screenshot.
