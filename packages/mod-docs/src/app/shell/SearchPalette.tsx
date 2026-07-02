/**
 * ⌘K search over the whole doc set + the op reference — fuzzy, client-side,
 * one small corpus fetch on first open.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { fuzzyFilter } from "../lib/fuzzy";
import { pageHref } from "../lib/api";
import { appBoot } from "../lib/config";
import { useDocs } from "./Shell";

interface PageEntry {
  chapter: string;
  file: string;
  title: string;
  headings: string[];
}
interface Corpus {
  pages: PageEntry[];
  ops: Array<{ type: string; description: string }>;
}

interface Item {
  id: string;
  label: string;
  hint: string;
  to: string;
  text: string;
}

let corpusPromise: Promise<Corpus> | null = null;
function fetchCorpus(): Promise<Corpus> {
  if (!corpusPromise) {
    corpusPromise = fetch(`${appBoot.apiBase}/search-index`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Corpus>;
    });
    corpusPromise.catch(() => (corpusPromise = null));
  }
  return corpusPromise;
}

export function useSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { manifest } = useDocs();
  const primarySlug = manifest.chapters[0]?.slug;

  useEffect(() => {
    void fetchCorpus().then(setCorpus).catch(() => setCorpus({ pages: [], ops: [] }));
    inputRef.current?.focus();
  }, []);

  const items = useMemo<Item[]>(() => {
    if (!corpus) return [];
    const pageItems: Item[] = corpus.pages.map((p) => ({
      id: `${p.chapter}/${p.file}`,
      label: p.title,
      hint: p.chapter,
      to: pageHref(primarySlug, p.chapter, p.file),
      text: `${p.title} ${p.headings.join(" ")} ${p.chapter}`,
    }));
    const opItems: Item[] = corpus.ops.map((o) => ({
      id: `op:${o.type}`,
      label: o.type,
      hint: "op",
      to: `/ops/${o.type}`,
      text: `${o.type} ${o.description}`,
    }));
    return fuzzyFilter([...pageItems, ...opItems], q, (i) => i.text).slice(0, 12);
  }, [corpus, q, primarySlug]);

  useEffect(() => setActive(0), [q]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    navigate(item.to);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-strong w-full max-w-[34rem] overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2.5 border-b px-4 py-3 hairline">
          <Search size={15} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              if (e.key === "Enter") go(items[active]);
            }}
            placeholder="Search docs + ops…"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: "var(--fg)" }}
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted hairline">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {!corpus && <div className="px-4 py-3 text-[13px] text-muted">loading…</div>}
          {corpus && items.length === 0 && <div className="px-4 py-3 text-[13px] text-muted">No matches.</div>}
          {items.map((item, i) => (
            <button
              key={item.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              className="flex w-full items-baseline gap-3 px-4 py-2 text-left"
              style={{ background: i === active ? "var(--glass-bg-strong)" : undefined }}
            >
              <span className={`min-w-0 flex-1 truncate text-[13.5px] ${item.hint === "op" ? "font-mono" : ""}`}>
                {item.label}
              </span>
              <span className="shrink-0 text-[11px] text-muted">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
