import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useManifest, useOps, useWorkflows } from "../lib/queries";
import { Search } from "../components/icon";

interface Item {
  id: string;
  label: string;
  group: string;
  go: string; // route to navigate to
}

/** Fuzzy command palette (⌘K): workflows, ops, pages, registered commands. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: workflows } = useWorkflows();
  const { data: ops } = useOps();
  const { data: manifest } = useManifest();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
    for (const c of manifest?.commands ?? []) list.push({ id: c.id, label: c.label, group: c.group ?? "Command", go: "/workflows" });
    return list;
  }, [workflows, ops, manifest]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(q)).slice(0, 20);
  }, [items, query]);

  // Global ⌘K to open is handled by a window listener mounted once.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const choose = (item: Item | undefined) => {
    if (!item) return;
    navigate(item.go);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong w-full max-w-xl overflow-hidden rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b hairline px-4 py-3">
          <Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
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
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && <div className="text-muted px-3 py-6 text-center text-sm">No matches.</div>}
          {filtered.map((item, i) => (
            <button
              key={item.id}
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
