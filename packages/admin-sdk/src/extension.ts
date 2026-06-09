/**
 * @pattern/admin-sdk — extension surface helpers (mod-admin-spec §6, §12).
 *
 * Framework-agnostic pieces of the adoption lever: build the nav from the
 * aggregated menu manifest (categories from the union of `MenuEntry.category`,
 * ordered by `order` then label), and register ⌘K commands / declarative pages.
 * The admin shell renders `NavSection[]`; React hooks wrapping these land with
 * the SPA.
 */

import type { CommandDef, MenuEntry, PageDef, DeclarativeView } from "@pattern/core";

export type { CommandDef, MenuEntry, PageDef, DeclarativeView } from "@pattern/core";

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
