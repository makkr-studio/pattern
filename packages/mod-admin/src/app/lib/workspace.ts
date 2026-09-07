/**
 * The workflow workspace — which workflows are OPEN (the tab strip above every
 * workflow page) and each one's editor draft, persisted in localStorage so
 * closing the browser never loses work.
 *
 * One store, two readers: the editor writes drafts as you type (debounced);
 * the workspace strip and the deployment state read them back through
 * `useWorkspace()` — a `useSyncExternalStore` snapshot bumped on every write,
 * so a dirty dot appears the moment the canvas diverges from what's saved.
 *
 * Keys: a saved workflow is keyed by its slug; the one unsaved brand-new
 * workflow is `NEW_KEY` (at most one at a time — Save renames it to its slug).
 */

import { useSyncExternalStore } from "react";
import type { WorkflowDoc } from "@pattern-js/admin-sdk";

/** The tab key of an unsaved brand-new workflow (at most one at a time). */
export const NEW_KEY = "__new__";
const TABS_KEY = "pattern.admin.editor.tabs";
const DRAFT_PREFIX = "pattern.admin.editor.draft.";
const VIEWPORT_PREFIX = "pattern.admin.editor.viewport.";
/** Pre-tabs single-draft key — migrated on first load. */
const LEGACY_DRAFT_KEY = "pattern.admin.editor.draft";

/** One tab's canvas, continuously persisted so closing/switching never loses
 *  work. `slug` is null for a brand-new workflow; `dirty` = differs from the
 *  last saved version (drives the dot + discard guard). */
export interface EditorDraft {
  slug: string | null;
  newSlug?: string;
  doc: WorkflowDoc;
  dirty: boolean;
  at: number;
}

export interface OpenTabs {
  open: string[];
  /** Where the workspace was last — the catalog's "continue" chip. */
  last?: string;
}

/** A viewport (zoom + pan) as xyflow serializes it. */
export interface SavedViewport {
  x: number;
  y: number;
  zoom: number;
}

export const tabKeyOf = (slug: string | undefined | null): string => slug ?? NEW_KEY;
/** The URL segment of a tab key (`/workflows/<seg>/…`). */
export const tabSlugOf = (key: string): string => (key === NEW_KEY ? "new" : key);

// ── change notification ──────────────────────────────────────────────────────
const listeners = new Set<() => void>();
let version = 0;
function notify(): void {
  version++;
  for (const l of listeners) l();
}

// ── drafts ───────────────────────────────────────────────────────────────────
export function readDraft(key: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    const d = raw ? (JSON.parse(raw) as EditorDraft) : null;
    return d && Array.isArray(d.doc?.nodes) ? d : null;
  } catch {
    return null;
  }
}
export function writeDraft(key: string, d: EditorDraft | null): void {
  try {
    if (d) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* storage full/blocked — drafts are best-effort */
  }
  notify();
}
export const removeDraft = (key: string): void => writeDraft(key, null);

// ── per-tab viewport (zoom + pan) ────────────────────────────────────────────
export function readViewport(key: string): SavedViewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_PREFIX + key);
    const v = raw ? (JSON.parse(raw) as SavedViewport) : null;
    return v && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}
export function writeViewport(key: string, v: SavedViewport): void {
  try {
    localStorage.setItem(VIEWPORT_PREFIX + key, JSON.stringify(v));
  } catch {
    /* best-effort */
  }
}
export function removeViewport(key: string): void {
  try {
    localStorage.removeItem(VIEWPORT_PREFIX + key);
  } catch {
    /* best-effort */
  }
}

// ── open tabs ────────────────────────────────────────────────────────────────
export function readTabs(): OpenTabs {
  migrateLegacyDraft();
  try {
    const t = JSON.parse(localStorage.getItem(TABS_KEY) ?? "") as OpenTabs;
    if (Array.isArray(t.open)) return { open: t.open.filter((k) => typeof k === "string"), last: t.last };
  } catch {
    /* default below */
  }
  return { open: [] };
}
export function writeTabs(t: OpenTabs): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(t));
  } catch {
    /* best-effort */
  }
  notify();
}

/** Make `key` an open tab (idempotent) and the last-visited one. */
export function openTab(key: string): string[] {
  const t = readTabs();
  const open = t.open.includes(key) ? t.open : [...t.open, key];
  writeTabs({ open, last: key });
  return open;
}

/** Close a tab: its draft and viewport go too. Returns the remaining tabs and
 *  the neighbor to land on (the one before it, else the one after, else null). */
export function closeTab(key: string): { open: string[]; neighbor: string | null } {
  const t = readTabs();
  const idx = t.open.indexOf(key);
  const open = t.open.filter((k) => k !== key);
  const neighbor = idx === -1 ? null : (open[idx - 1] ?? open[idx] ?? null);
  removeViewport(key);
  removeDraft(key);
  writeTabs({ open, last: t.last === key ? (neighbor ?? undefined) : t.last });
  return { open, neighbor };
}

/** The new-workflow tab becomes the saved slug's tab (first Save). */
export function renameTab(from: string, to: string): void {
  const t = readTabs();
  const open = t.open.map((k) => (k === from ? to : k)).filter((k, i, a) => a.indexOf(k) === i);
  writeTabs({ open, last: t.last === from ? to : t.last });
}

/** One-time migration of the pre-tabs single draft into its own tab. */
function migrateLegacyDraft(): void {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as EditorDraft;
    if (d && Array.isArray(d.doc?.nodes)) {
      const key = tabKeyOf(d.slug);
      localStorage.setItem(DRAFT_PREFIX + key, raw);
      const t = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{"open":[]}') as OpenTabs;
      if (!t.open.includes(key)) t.open.push(key);
      t.last = key;
      localStorage.setItem(TABS_KEY, JSON.stringify(t));
    }
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    /* best-effort */
  }
}

// ── React snapshot ───────────────────────────────────────────────────────────
export interface WorkspaceSnapshot {
  open: string[];
  last?: string;
  /** Per open tab: is its draft dirty, and (new tab) the slug being typed. */
  drafts: Record<string, { dirty: boolean; newSlug?: string }>;
}

let cached: WorkspaceSnapshot | null = null;
let cachedVersion = -1;
function snapshot(): WorkspaceSnapshot {
  if (cached && cachedVersion === version) return cached;
  const t = readTabs();
  const drafts: WorkspaceSnapshot["drafts"] = {};
  for (const k of t.open) {
    const d = readDraft(k);
    drafts[k] = { dirty: Boolean(d?.dirty), newSlug: d?.newSlug };
  }
  cached = { open: t.open, last: t.last, drafts };
  cachedVersion = version;
  return cached;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // Another browser tab editing the same workflow changes the same keys.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("pattern.admin.editor.")) notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** The open tabs + each one's dirty state, live. */
export function useWorkspace(): WorkspaceSnapshot {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
