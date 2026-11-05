/**
 * @pattern-js/admin-sdk — extension surface helpers (admin internals §6, §12).
 *
 * Framework-agnostic pieces of the adoption lever: build the nav from the
 * aggregated menu manifest (categories from the union of `MenuEntry.category`,
 * ordered by `order` then label), and register ⌘K commands / declarative pages.
 * The admin shell renders `NavSection[]`; React hooks wrapping these land with
 * the SPA.
 */

import type { CommandDef, MenuEntry, PageDef, DeclarativeView } from "@pattern-js/core";

export type { CommandDef, MenuEntry, PageDef, DeclarativeView, RouteRef } from "@pattern-js/core";

export interface NavItem extends MenuEntry {}

export interface NavSection {
  category: string;
  items: NavItem[];
}

/**
 * Group menu entries into ordered sections. Items sort by `order` then `label`;
 * sections by their lowest item `order`, then category name.
 */
export function buildNav(menu: readonly MenuEntry[]): NavSection[] {
  const byCategory = new Map<string, NavItem[]>();
  for (const entry of menu) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }
  const sections: NavSection[] = [];
  for (const [category, items] of byCategory) {
    items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
    sections.push({ category, items });
  }
  const minOrder = (s: NavSection): number => Math.min(...s.items.map((i) => i.order ?? 100));
  sections.sort((a, b) => minOrder(a) - minOrder(b) || a.category.localeCompare(b.category));
  return sections;
}

/**
 * The admin's section vocabulary — where a `MenuEntry.category` lands in the
 * sidebar, top to bottom:
 *
 *  - **Home** — the dashboard.
 *  - **Workflows** — the catalog; every workflow opens as Editor · Runs · Versions · Settings.
 *  - **Activity** — what the system is doing: runs, metrics, the process.
 *  - **Resources** — what workflows use: data, vectors, secrets, email, AI providers.
 *  - **Administration** — people and money: users, sessions, tokens, billing, runtime settings.
 *  - **Reference** — what's installed: ops, mods, the system map.
 *
 * A mod contributes with one of these names. The pre-0.5 names (Overview,
 * Author, Observe, Catalog, Access, Data, System) map onto them so older mods
 * still land somewhere sensible; any other string becomes a section of its own
 * after the built-ins — a product mod (chat) keeps its own room.
 */
export const ADMIN_SECTIONS = ["Home", "Workflows", "Activity", "Resources", "Administration", "Reference"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const LEGACY_SECTIONS: Record<string, AdminSection> = {
  Overview: "Home",
  Author: "Workflows",
  Observe: "Activity",
  Catalog: "Reference",
  Access: "Administration",
  Data: "Resources",
  System: "Resources",
};

/** Map a menu category onto the admin's section vocabulary (unknown names pass through). */
export function canonicalSection(category: string): string {
  if ((ADMIN_SECTIONS as readonly string[]).includes(category)) return category;
  return LEGACY_SECTIONS[category] ?? category;
}

/**
 * `buildNav` for the admin shell: categories are canonicalized first, then the
 * built-in sections come in their fixed order and everything else follows,
 * alphabetically. Within a section, `order` then label — as `buildNav`.
 */
export function buildAdminNav(menu: readonly MenuEntry[]): NavSection[] {
  const rank = (c: string): number => {
    const i = (ADMIN_SECTIONS as readonly string[]).indexOf(c);
    return i === -1 ? ADMIN_SECTIONS.length : i;
  };
  return buildNav(menu.map((m) => ({ ...m, category: canonicalSection(m.category) }))).sort(
    (a, b) => rank(a.category) - rank(b.category) || (rank(a.category) === ADMIN_SECTIONS.length ? a.category.localeCompare(b.category) : 0),
  );
}

/** Identity helper for authoring a declarative page with type-checking (Tier 1). */
export function defineDeclarativePage(path: string, view: DeclarativeView): PageDef {
  return { path, view };
}

/** A simple registry mods + the shell use to collect menu entries (`registerMenu`). */
export class MenuRegistry {
  private readonly entries: MenuEntry[] = [];
  register(...entries: MenuEntry[]): void {
    this.entries.push(...entries);
  }
  all(): readonly MenuEntry[] {
    return this.entries;
  }
  nav(): NavSection[] {
    return buildNav(this.entries);
  }
}

/** A simple ⌘K command registry (`registerCommand`). */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDef>();
  register(...commands: CommandDef[]): void {
    for (const c of commands) this.commands.set(c.id, c);
  }
  all(): CommandDef[] {
    return [...this.commands.values()];
  }
  /** Recency-boosted fuzzy search across labels/groups (client-side index). */
  search(query: string, recent: readonly string[] = []): CommandDef[] {
    const q = query.trim().toLowerCase();
    const scored = this.all().map((c) => {
      const hay = `${c.label} ${c.group ?? ""}`.toLowerCase();
      let score = q === "" ? 0 : hay.includes(q) ? 10 - hay.indexOf(q) / 10 : -1;
      const r = recent.indexOf(c.id);
      if (r !== -1) score += (recent.length - r) * 0.5;
      return { c, score };
    });
    return scored
      .filter((s) => q === "" || s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.c);
  }
}
