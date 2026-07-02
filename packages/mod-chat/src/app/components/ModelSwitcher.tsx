/**
 * Model switcher: pick the language model (a mod-ai alias) for new turns. Hidden
 * when no aliases exist. The selection persists and is also used by voice mode.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Check, Cpu } from "lucide-react";
import { chatStore } from "../lib/store";

function Row({ label, sub, selected, onClick }: { label: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--line-soft)]">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" style={{ color: "var(--accent)" }}>
        {selected && <Check size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]" style={{ color: "var(--fg)" }}>
          {label}
        </span>
        <span className="block truncate text-[11px]" style={{ color: "var(--fg-faint)" }}>
          {sub}
        </span>
      </span>
    </button>
  );
}

export function ModelSwitcher() {
  const state = useSyncExternalStore(chatStore.subscribe, chatStore.getState);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void chatStore.loadModels();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (state.models.length === 0) return null; // no aliases → nothing to switch between

  const active = state.models.find((m) => m.name === state.selectedModel);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] transition-colors hover:border-[var(--fg-faint)]"
        style={{ borderColor: "var(--line)", color: "var(--fg-soft)" }}
        title="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Cpu size={13} />
        <span className="max-w-[10rem] truncate">{active ? active.name : "Default"}</span>
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-1 max-h-[60vh] w-60 overflow-y-auto rounded-xl border py-1 shadow-lg"
          style={{ borderColor: "var(--line)", background: "var(--bg-raised)" }}
          role="listbox"
        >
          <Row
            label="Default"
            sub="the app's configured model"
            selected={!state.selectedModel}
            onClick={() => {
              chatStore.setSelectedModel(null);
              setOpen(false);
            }}
          />
          {state.models.map((m) => (
            <Row
              key={m.name}
              label={m.name}
              sub={`${m.provider} · ${m.modelId}`}
              selected={state.selectedModel === m.name}
              onClick={() => {
                chatStore.setSelectedModel(m.name);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
