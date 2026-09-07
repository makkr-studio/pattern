/**
 * The op palette: fuzzy-searchable, filterable by mod, grouped by category
 * (color + icon coded), drag-to-add. Non-reusable ops live in a collapsed
 * "Advanced" section. Collapses to an icon rail to give the canvas the room.
 */

import { useMemo, useState } from "react";
import type { OpInfo } from "@pattern-js/admin-sdk";
import { GlassPanel } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { tip } from "../components/Tooltip";
import { PanelLeftClose, PanelLeftOpen, Search } from "../components/icon";
import { categoryOfType, categoryStyle, humanizeOp, paletteLabel } from "../lib/categories";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";

/** MIME type carrying an op across the palette→canvas drag. */
export const DND_TYPE = "application/x-pattern-op";

/** The rail's width when the palette is collapsed (matches the grid template). */
export const PALETTE_RAIL_PX = 44;

function groupByCategory(ops: OpInfo[]): [string, OpInfo[]][] {
  const m = new Map<string, OpInfo[]>();
  for (const op of ops) {
    const c = categoryOfType(op.type);
    const list = m.get(c) ?? [];
    list.push(op);
    m.set(c, list);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** One palette op: draggable onto the canvas (grab it!), tooltip with docs. */
function OpItem({ op }: { op: OpInfo }) {
  const category = categoryOfType(op.type);
  const cat = categoryStyle(category);
  const { Icon } = cat;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, op.type);
        e.dataTransfer.effectAllowed = "copy";
        sfx.play("drag");
      }}
      {...tip(
        <div className="space-y-1">
          <div className="font-mono text-[11px] opacity-70">{op.type}</div>
          {op.description && <Markdown text={op.description} />}
          <div className="text-muted">
            Drag onto the canvas to add{op.boundary && op.pair ? ` (brings its ${op.boundary === "trigger" ? "out-gate" : "trigger"} partner)` : ""}.
          </div>
        </div>,
      )}
      className="flex w-full cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] select-none hover:bg-white/5 active:cursor-grabbing"
    >
      <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
      <span className="truncate">{paletteLabel(op.type, category)}</span>
    </div>
  );
}

/** A collapsible category section with colored header + op items. */
function CategorySection({ category, ops, open, onToggle }: { category: string; ops: OpInfo[]; open: boolean; onToggle: () => void }) {
  const cat = categoryStyle(category);
  const { Icon } = cat;
  return (
    <div className="mb-0.5">
      <button onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
        <Icon size={15} style={{ color: cat.color }} />
        <span className="text-[13px] font-semibold capitalize">{category}</span>
        <span className="text-muted ml-auto text-[10px]">{ops.length}</span>
      </button>
      {open && (
        <div className="ml-1 border-l pl-2" style={{ borderColor: cat.border }}>
          {ops.map((op) => (
            <OpItem key={op.type} op={op} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsed: a slim rail with one control — the search glyph — that reopens
 * the palette. The category icons below it are a table of contents: clicking
 * one reopens the palette scrolled to that category.
 */
function PaletteRail({ ops, onOpen }: { ops: OpInfo[]; onOpen: (category?: string) => void }) {
  const categories = useMemo(() => groupByCategory(ops.filter((o) => o.reusable !== false)), [ops]);
  return (
    <GlassPanel className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto p-1.5">
      <button
        type="button"
        aria-label="Open the op palette"
        {...tip("Open the op palette (search ops)")}
        onClick={() => onOpen()}
        className="text-muted rounded-lg p-2 hover:bg-white/10 hover:text-[var(--fg)]"
      >
        <PanelLeftOpen size={15} />
      </button>
      <div className="my-1 h-px w-5 bg-white/10" />
      {categories.map(([category, list]) => {
        const cat = categoryStyle(category);
        const { Icon } = cat;
        return (
          <button
            key={category}
            type="button"
            aria-label={`Open palette at ${category}`}
            {...tip(`${category} · ${list.length} op${list.length === 1 ? "" : "s"}`)}
            onClick={() => onOpen(category)}
            className="rounded-lg p-1.5 hover:bg-white/10"
          >
            <Icon size={15} style={{ color: cat.color }} />
          </button>
        );
      })}
    </GlassPanel>
  );
}

export function Palette({ ops, open, onToggle }: { ops: OpInfo[]; open: boolean; onToggle: (open: boolean) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mod, setMod] = useState<string>("");
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const mods = useMemo(() => [...new Set(ops.map((o) => o.mod ?? "core"))].sort(), [ops]);
  const filtered = useMemo(() => {
    let list = ops;
    if (mod) list = list.filter((o) => (o.mod ?? "core") === mod);
    return fuzzyFilter(list, query, (o) => `${o.type} ${o.title ?? ""} ${humanizeOp(o.type)}`);
  }, [ops, mod, query]);
  const searching = query.trim().length > 0;

  const reusable = useMemo(() => groupByCategory(filtered.filter((o) => o.reusable !== false)), [filtered]);
  const advanced = useMemo(() => filtered.filter((o) => o.reusable === false), [filtered]);
  const advancedGroups = useMemo(() => groupByCategory(advanced), [advanced]);

  if (!open) {
    return (
      <PaletteRail
        ops={ops}
        onOpen={(category) => {
          if (category) {
            setCollapsed((s) => {
              const n = new Set(s);
              n.delete(category);
              return n;
            });
            setJumpTo(category);
          }
          onToggle(true);
          sfx.play("open");
        }}
      />
    );
  }

  return (
    <GlassPanel className="flex min-h-0 flex-col p-2">
      {/* Filter bar */}
      <div className="mb-2 space-y-1.5 px-0.5">
        <div className="flex items-center gap-1.5">
          <div className="glass flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5">
            <Search size={12} className="text-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ops…"
              aria-label="Search ops"
              className="w-full bg-transparent text-xs outline-none"
            />
            {query && (
              <button type="button" aria-label="Clear search" className="text-muted text-[10px]" onClick={() => setQuery("")}>
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="Collapse the op palette"
            {...tip("Collapse the palette to a rail — more room for the canvas")}
            onClick={() => {
              onToggle(false);
              sfx.play("close");
            }}
            className="text-muted shrink-0 rounded-lg p-1.5 hover:bg-white/10 hover:text-[var(--fg)]"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
        <select
          value={mod}
          onChange={(e) => setMod(e.target.value)}
          aria-label="Filter by mod"
          className="glass w-full rounded-lg px-2 py-1 text-xs outline-none [&>option]:bg-[var(--bg)]"
        >
          <option value="">All mods</option>
          {mods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Op list — its own scroll context */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          // Flat ranked list while searching (best match first).
          <div>
            {filtered.length === 0 && <div className="text-muted px-2 py-4 text-center text-xs">No ops match.</div>}
            {filtered.map((op) => (
              <OpItem key={op.type} op={op} />
            ))}
          </div>
        ) : (
          <>
            {reusable.map(([category, list]) => (
              <div
                key={category}
                ref={(el) => {
                  if (el && jumpTo === category) {
                    el.scrollIntoView({ block: "start" });
                    setJumpTo(null);
                  }
                }}
              >
                <CategorySection category={category} ops={list} open={!collapsed.has(category)} onToggle={() => toggle(category)} />
              </div>
            ))}

            {advanced.length > 0 && (
              <div className="mt-2 border-t hairline pt-2">
                <button onClick={() => setAdvancedOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
                  <span className="text-muted text-[10px]">{advancedOpen ? "▾" : "▸"}</span>
                  <span className="text-muted text-xs font-semibold uppercase tracking-wider">Advanced</span>
                  <span className="text-muted ml-auto text-[10px]">{advanced.length}</span>
                </button>
                {advancedOpen && (
                  <div className="mt-1 opacity-80">
                    {advancedGroups.map(([category, list]) => (
                      <div key={category} className="mb-1">
                        <div className="text-muted px-2 py-1 text-[10px] font-semibold capitalize">{category}</div>
                        <div className="ml-1 border-l hairline pl-2">
                          {list.map((op) => (
                            <OpItem key={op.type} op={op} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </GlassPanel>
  );
}
