import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api } from "../lib/api";
import { useManifest, useOps, useWorkflows } from "../lib/queries";
import { Search } from "../components/icon";
import { JsonView } from "../components/ui";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";

interface Item {
  id: string;
  label: string;
  group: string;
  /** Route to navigate to… */
  go?: string;
  /** …or an op type to invoke inline (mod commands with `run`). */
  run?: string;
}

/** Fuzzy command palette (⌘K): workflows, ops, pages, registered commands. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: workflows } = useWorkflows();
  const { data: ops } = useOps();
  const { data: manifest } = useManifest();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<{ label: string; data: unknown } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = "cmdk-list";

  const items: Item[] = useMemo(() => {
    const list: Item[] = [
      { id: "nav:workflows", label: "Workflows", group: "Go to", go: "/workflows" },
      { id: "nav:runs", label: "Runs", group: "Go to", go: "/runs" },
      { id: "nav:ops", label: "Ops", group: "Go to", go: "/ops" },
      { id: "nav:system", label: "System map", group: "Go to", go: "/system" },
      { id: "nav:metrics", label: "Metrics", group: "Go to", go: "/metrics" },
    ];
    for (const w of workflows ?? []) list.push({ id: `wf:${w.slug}`, label: w.name, group: "Workflow", go: `/editor/${w.slug}` });
    for (const o of ops ?? []) list.push({ id: `op:${o.type}`, label: o.type, group: "Op", go: `/ops/${o.type}` });
    // Mod commands: `path` navigates, `run` invokes the source op inline.
    for (const c of manifest?.commands ?? []) {
      if (!c.path && !c.run) continue;
      list.push({ id: c.id, label: c.label, group: c.group ?? "Command", go: c.path, run: c.path ? undefined : c.run });
    }
    return list;
  }, [workflows, ops, manifest]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 12);
    return fuzzyFilter(items, query, (i) => `${i.label} ${i.group}`).slice(0, 20);
  }, [items, query]);

  // Global ⌘K to open is handled by a window listener mounted once.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setResult(null);
      // rAF instead of a timed guess — focus lands after the portal paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.go) {
      sfx.play("nav");
      navigate(item.go);
      onClose();
      return;
    }
    if (item.run) {
      // Run the command's source op and show its data inline (self-reflection:
      // the palette is wiring over the same invoke endpoint pages use).
      sfx.play("run");
      setResult({ label: item.label, data: "…" });
      api
        .invoke(item.run)
        .then((data) => {
          setResult({ label: item.label, data });
          sfx.play("ok");
        })
        .catch((err: unknown) => {
          setResult({ label: item.label, data: { error: err instanceof Error ? err.message : String(err) } });
          sfx.play("error");
        });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-xl"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong w-full max-w-xl overflow-hidden rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b hairline px-4 py-3">
          <Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `cmdk-${filtered[active].id}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, filtered.length - 1));
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              if (e.key === "Enter") choose(filtered[active]);
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search workflows, ops, pages…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--fg-muted)]"
          />
        </div>
        <div id={listId} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && <div className="text-muted px-3 py-6 text-center text-sm">No matches.</div>}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              id={`cmdk-${item.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                i === active ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <span>{item.label}</span>
              <span className="text-muted text-xs">{item.group}</span>
            </button>
          ))}
        </div>
        {result && (
          <div className="border-t hairline p-3">
            <div className="text-muted mb-1.5 text-xs">{result.label}</div>
            {result.data === "…" ? (
              <div className="text-muted text-xs">Running…</div>
            ) : (
              <JsonView value={result.data} className="max-h-48" />
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

/** Hook: open the palette on ⌘K / Ctrl-K from anywhere. */
export function useCommandHotkey(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
