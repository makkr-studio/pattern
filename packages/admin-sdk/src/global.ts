/**
 * @pattern/admin-sdk — the Tier-2 runtime global (admin internals §6, §12).
 *
 * The admin SPA exposes its shared dependencies on `globalThis.__PATTERN_ADMIN__`
 * so Tier-2 ESM remotes don't bundle their own React or re-implement the visual
 * language. This module types that contract — deliberately **React-free** (the
 * SDK has zero UI dependencies), so components are typed as opaque
 * function-components a remote casts once:
 *
 *   const { React, api, ui } = globalThis.__PATTERN_ADMIN__ as PatternAdminGlobal;
 *   const { GlassPanel, NeonButton } = ui;
 *   export default function Page() {
 *     return React.createElement(GlassPanel, { className: "p-6" }, "hi");
 *   }
 */

import type { AdminClient } from "./client.js";

/** An opaque React function component (the SDK stays React-free). */
export type UiComponent = (props: Record<string, unknown>) => unknown;

/** The glass UI kit shared with Tier-2 pages (admin internals §12). */
export interface PatternAdminUi {
  GlassPanel: UiComponent;
  GlowCard: UiComponent;
  NeonButton: UiComponent;
  Badge: UiComponent;
  Dot: UiComponent;
  Spinner: UiComponent;
  EmptyState: UiComponent;
  PageHeader: UiComponent;
  Table: UiComponent;
  JsonView: UiComponent;
  Modal: UiComponent;
  FormFromSchema: UiComponent;
  Markdown: UiComponent;
}

/** Shape of `globalThis.__PATTERN_ADMIN__` inside the admin SPA. */
export interface PatternAdminGlobal {
  /** The host's React namespace (createElement, hooks, …). */
  React: unknown;
  /** The host's authenticated API client. */
  api: AdminClient;
  /** The glass component kit. */
  ui: PatternAdminUi;
  /** The host's motion.dev factory (`motion.div`, …) — shared so Tier-2 pages animate with the same library. */
  motion: unknown;
  /** The host's lucide-react icon namespace (`lucide.Box`, …) — the admin's icon set, shared. */
  lucide: unknown;
}
