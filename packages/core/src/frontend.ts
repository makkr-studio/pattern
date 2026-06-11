/**
 * Pattern — frontend contribution contract (admin-spec P2, §6/§12).
 *
 * A mod may contribute UI to a frontend host (the admin) declaratively. These
 * types are the *data* shape of that contribution; they are deliberately
 * **React-free** so `@pattern/core` keeps zero UI dependencies. `@pattern/admin-sdk`
 * re-types the Tier-2 `element` loader with the concrete `React.ComponentType`.
 *
 * The admin host aggregates `frontend` across all installed mods: menu entries
 * become nav items (categories from the union of `MenuEntry.category`), and
 * pages mount at their `path`. Two tiers:
 *
 *  - **Tier 1** — a declarative `view` (table/form/chart/json/markdown/graph/iframe)
 *    rendered by the admin's component kit. No build step. Data sources are
 *    workflows/ops, so self-reflection holds.
 *  - **Tier 2** — a built ESM bundle (`element`) the admin `import()`s at runtime.
 */

/** A nav entry contributed by a mod (admin-spec §6). */
export interface MenuEntry {
  /** Grouping category; the shell builds sections from the union of these. */
  category: string;
  label: string;
  /** lucide-react icon name (resolved by the admin shell). */
  icon?: string;
  /** Route path the entry links to (matches a `PageDef.path`). */
  path: string;
  /** Ordering within the category; ascending, then label. Default 100. */
  order?: number;
  /** Reserved: unenforced until an auth provider mod lands (admin-spec §6). */
  scopes?: string[];
}

/** A column in a declarative table view. */
export interface DeclarativeColumn {
  key: string;
  label?: string;
  /** Optional hint for the renderer (e.g. "date", "badge", "code"). */
  format?: string;
}

/** A table-level action in a declarative table view: a button that runs an op/workflow. */
export interface DeclarativeAction {
  label: string;
  /** The op type or workflow id to run. */
  run: string;
  icon?: string;
  /** "silent" (default) refreshes the source; "show" renders the op's result. */
  result?: "silent" | "show";
}

/**
 * A per-row action: a button on every table row that invokes an op with
 * arguments mapped from the row, e.g. `{ args: { userId: "id" } }` calls
 * `run` with `{ userId: row.id }`. The renderer refreshes the table after.
 */
export interface DeclarativeRowAction {
  label: string;
  /** The op type or workflow id to run. Mutually exclusive with `path`. */
  run?: string;
  /**
   * Navigate instead of running: a page path whose `:tokens` are filled from
   * the row via `args`, e.g. `path: "/x/identity/users/:userId"` +
   * `args: { userId: "id" }` → `/x/identity/users/<row.id>`.
   */
  path?: string;
  /** Op-argument name → row key (also fills `path` tokens). */
  args?: Record<string, string>;
  icon?: string;
  /** Ask for confirmation before running. */
  confirm?: boolean;
  /**
   * "silent" (default): the refreshed table IS the feedback — nothing pops.
   * "show": the op's return value is for the operator (a minted link, a
   * report) — rendered as labeled rows; a `copy` key gets a Copy button.
   * Errors always surface regardless.
   */
  result?: "silent" | "show";
}

/** A field in a mod-contributed settings section. */
export interface SettingsField {
  /** Key in the source/submit ops' value object. */
  key: string;
  label: string;
  type: "toggle" | "select" | "text" | "number";
  /** Choices for `select`. */
  options?: Array<{ value: string; label: string }>;
  description?: string;
}

/**
 * A mod-contributed section on the admin's Settings page. `source` is an op
 * returning the current values keyed by field; `submit` is an op receiving
 * `{ [key]: value }` patches. Same self-reflection as declarative pages —
 * settings are wiring over ops, not a bespoke surface.
 */
export interface SettingsSection {
  id: string;
  title: string;
  description?: string;
  source: string;
  submit: string;
  fields: SettingsField[];
}

/**
 * A declarative page body (Tier 1). All data sources are op types or workflow
 * ids, so a declarative page is *wiring over the self-reflecting API*, never a
 * new bespoke surface.
 */
export type DeclarativeView =
  | {
      kind: "table";
      source: string;
      columns: DeclarativeColumn[];
      actions?: DeclarativeAction[];
      rowActions?: DeclarativeRowAction[];
    }
  | { kind: "form"; schema: unknown; submit: string }
  | { kind: "chart"; source: string; spec: unknown }
  | { kind: "json" | "markdown"; source: string }
  /** A single object rendered as labeled rows (a `copy` key gets a Copy button). */
  | { kind: "detail"; source: string }
  | { kind: "graph"; workflow: string }
  | { kind: "iframe"; url: string };

/**
 * A page contributed by a mod. Tier 1 carries a declarative `view` (or a
 * stacked list of `views` for detail-style pages); Tier 2 carries an
 * `element` — a loader for a built ESM module whose default export is a
 * component (typed concretely in `@pattern/admin-sdk`).
 *
 * Paths may carry `:params` (`/x/identity/users/:userId`): the host matches
 * them like routes and passes the extracted params as args to every view's
 * source op — which is how a row click becomes a details page.
 */
export type PageDef =
  | { path: string; view: DeclarativeView }
  | { path: string; views: Array<{ title?: string; view: DeclarativeView }> }
  | { path: string; element: () => Promise<{ default: unknown }> }
  /** Tier-2 ESM remote by URL — serializable, so it survives the manifest endpoint. */
  | { path: string; remote: string };

/** A ⌘K command contributed by a mod (admin-spec §6, §15.2). */
export interface CommandDef {
  id: string;
  label: string;
  /** The op type or workflow id to run, or a client-side action key. */
  run?: string;
  /** Route to navigate to when chosen (e.g. a contributed page's path). */
  path?: string;
  icon?: string;
  /** Grouping in the palette. */
  group?: string;
}

/**
 * A mod's frontend manifest (admin-spec P2). `assets` is an opaque pointer the
 * host understands — for the admin it is the name of a registered filesystem
 * whose files are served via `boundary.http.app`.
 */
export interface FrontendContribution {
  /** Built SPA/asset bundle pointer (e.g. a registered filesystem name). */
  assets?: string;
  menu?: MenuEntry[];
  pages?: PageDef[];
  commands?: CommandDef[];
  /** Sections rendered on the admin's Settings page (System → Settings). */
  settings?: SettingsSection[];
}
