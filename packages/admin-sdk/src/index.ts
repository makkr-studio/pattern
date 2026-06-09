/**
 * @pattern/admin-sdk — the stable surface admin UIs and mods import
 * (mod-admin-spec §6, §12).
 *
 * This release ships the **framework-agnostic core**: the wire protocol types,
 * a typed API client over the workflow-backed endpoints (incl. the SSE run
 * tail), and the extension helpers (nav aggregation, command + menu registries,
 * declarative-page authoring). The React layer — `useApi()`/`useTheme()` hooks
 * and the glass UI kit (`Table`, `FormFromSchema`, `GraphView`, `GlassPanel`, …)
 * — lands with the SPA, built on exactly this core.
 */

export * from "./protocol.js";
export {
  AdminClient,
  AdminApiError,
  createAdminClient,
  type AdminClientOptions,
  type RunListFilter,
} from "./client.js";
export {
  buildNav,
  defineDeclarativePage,
  MenuRegistry,
  CommandRegistry,
  type NavItem,
  type NavSection,
  type MenuEntry,
  type PageDef,
  type DeclarativeView,
  type CommandDef,
} from "./extension.js";
