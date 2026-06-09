# @pattern/admin-sdk

The stable surface admin UIs and mods import to extend [`@pattern/mod-admin`](../mod-admin)
(mod-admin-spec §6, §12) — the adoption lever.

> **This release ships the framework-agnostic core**: the wire-protocol types, a
> typed API client over the workflow-backed endpoints (incl. the SSE run tail),
> and the extension helpers (nav aggregation, command + menu registries,
> declarative-page authoring). The React layer — `useApi()`/`useTheme()` hooks
> and the glass UI kit — lands with the SPA, built on exactly this core.

## Typed client

```ts
import { createAdminClient } from "@pattern/admin-sdk";

const api = createAdminClient({ baseUrl: "/admin" }); // uses global fetch

const workflows = await api.workflows.list();
const { meta, liveDoc } = await api.workflows.get("greeting");
const saved = await api.workflows.save("greeting", doc, "tweak copy");
const result = await api.deploy("greeting", saved.version!.id); // route-conflict checked
const ops = await api.ops.list();
const compat = await api.portsCompatible(
  { op: "core.string.template", port: "out", dir: "out" },
  { op: "boundary.http.response", port: "body", dir: "in" },
);
const metrics = await api.metrics(/* minutes? */);

for await (const span of api.runs.tail("greeting")) {
  // live node spans (SSE), parsed
}
```

Inject `fetch` and `headers` for non-browser hosts / auth. Errors throw
`AdminApiError` (with `status` + parsed `body`).

## Extension helpers

```ts
import { buildNav, MenuRegistry, CommandRegistry, defineDeclarativePage } from "@pattern/admin-sdk";

const nav = buildNav(menuEntries); // → ordered NavSection[] (category union, order then label)

const commands = new CommandRegistry();
commands.register({ id: "deploy", label: "Deploy…", group: "Author" });
commands.search("dep", recentIds); // recency-boosted fuzzy match

const page = defineDeclarativePage("/x/metrics", { kind: "table", source: "mymod.metrics.list", columns: [] });
```

Menu/page/command **types** (`MenuEntry`, `PageDef`, `DeclarativeView`, `CommandDef`)
come from `@pattern/core` (the `PatternMod.frontend` contract), re-exported here.
