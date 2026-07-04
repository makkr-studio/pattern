/**
 * BuddyDock — the editor's assistant pane (rendered when @pattern-js/mod-buddy
 * is installed; EditorPage detects it via the ui manifest's `buddy.open`
 * command).
 *
 * One SSE call per turn (POST /buddy/api/turn — root-absolute: buddy's routes
 * live at the server root, not under the admin mount). Turn events render as
 * they stream: text deltas, tool chips that deep-link to the sub-run, and —
 * for pattern_propose_workflow — an Apply card whose doc comes straight from
 * the tool call's args. Apply hands the doc to EditorPage (undoable, marks
 * the canvas dirty); Save and Deploy stay the human's buttons.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowDoc } from "@pattern-js/admin-sdk";
import { GlassPanel, NeonButton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { sfx } from "../lib/sfx";
import { Check, ExternalLink, Loader2, RotateCcw, Send, Sparkles, Square, Wrench, X } from "lucide-react";

type DockItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; toolName: string; phase: "start" | "done" | "error"; subRunId?: string; error?: string }
  | { kind: "apply"; doc: WorkflowDoc; summary: string; valid: boolean | null; applied: boolean }
  | { kind: "note"; text: string };

interface TurnEvent {
  type: string;
  delta?: string;
  text?: string;
  toolName?: string;
  callId?: string;
  phase?: "start" | "done" | "error";
  args?: unknown;
  result?: unknown;
  error?: string;
  subRunId?: string;
  message?: string;
  stopReason?: string;
}

interface BuddyStatus {
  ok: boolean;
  tools: number;
  model: string;
  knowledge: "semantic" | "lexical";
  threads: boolean;
}

async function* sseTurn(body: object, signal: AbortSignal): AsyncGenerator<TurnEvent> {
  const res = await fetch("/buddy/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`turn failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            yield JSON.parse(line.slice(5)) as TurnEvent;
          } catch {
            /* partial/keepalive line */
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Seed display items from a persisted thread (NeutralMessages). */
function itemsFromThread(messages: unknown[]): DockItem[] {
  const out: DockItem[] = [];
  for (const raw of messages) {
    const m = raw as { role?: string; content?: unknown };
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((p) => (typeof (p as { text?: string }).text === "string" ? (p as { text: string }).text : ""))
              .join("")
          : "";
    if (text.trim()) out.push({ kind: m.role, text } as DockItem);
  }
  return out;
}

export function BuddyDock({
  slug,
  getDoc,
  onApply,
  onClose,
}: {
  slug: string | undefined;
  getDoc: () => WorkflowDoc;
  onApply: (doc: WorkflowDoc) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<DockItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BuddyStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the persisted thread + capabilities on mount / workflow switch.
  useEffect(() => {
    let live = true;
    void fetch(`/buddy/api/thread?slug=${encodeURIComponent(slug ?? "")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t: { messages?: unknown[] } | null) => {
        if (live && t?.messages) setItems(itemsFromThread(t.messages));
      })
      .catch(() => {});
    void fetch("/buddy/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: BuddyStatus | null) => live && s && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items]);

  const push = (item: DockItem) => setItems((prev) => [...prev, item]);
  const patchLast = (patch: (item: DockItem) => DockItem, match: (item: DockItem) => boolean) =>
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (match(prev[i]!)) return [...prev.slice(0, i), patch(prev[i]!), ...prev.slice(i + 1)];
      }
      return prev;
    });

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    push({ kind: "user", text: message });
    const turnId = crypto.randomUUID();
    turnIdRef.current = turnId;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const events = sseTurn({ message, slug, doc: getDoc(), turnId }, controller.signal);
      for await (const e of events) {
        if (e.type === "text.delta" && e.delta) {
          setItems((prev) => {
            const last = prev.at(-1);
            if (last?.kind === "assistant") {
              return [...prev.slice(0, -1), { kind: "assistant", text: last.text + e.delta }];
            }
            return [...prev, { kind: "assistant", text: e.delta! }];
          });
        } else if (e.type === "tool.activity" && e.toolName) {
          if (e.phase === "start") {
            push({ kind: "tool", toolName: e.toolName, phase: "start", subRunId: e.subRunId });
            if (e.toolName === "pattern_propose_workflow") {
              const args = e.args as { doc?: WorkflowDoc; summary?: string } | undefined;
              if (args?.doc) push({ kind: "apply", doc: args.doc, summary: args.summary ?? "", valid: null, applied: false });
            }
          } else {
            patchLast(
              (item) => ({ ...(item as Extract<DockItem, { kind: "tool" }>), phase: e.phase!, subRunId: e.subRunId ?? (item as { subRunId?: string }).subRunId, error: e.error }),
              (item) => item.kind === "tool" && item.toolName === e.toolName && item.phase === "start",
            );
            if (e.toolName === "pattern_propose_workflow") {
              const ok = e.phase === "done" && JSON.stringify(e.result ?? "").includes('"ok":true');
              patchLast(
                (item) => ({ ...(item as Extract<DockItem, { kind: "apply" }>), valid: ok }),
                (item) => item.kind === "apply" && item.valid === null,
              );
            }
          }
        } else if (e.type === "approval.request") {
          push({ kind: "note", text: "Buddy asked to deploy — that stays your call: review, then use the editor's Deploy button." });
        } else if (e.type === "error" && e.message) {
          push({ kind: "note", text: `⚠ ${e.message}` });
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") push({ kind: "note", text: `⚠ ${(err as Error).message}` });
    } finally {
      setBusy(false);
      abortRef.current = null;
      turnIdRef.current = null;
    }
  }, [input, busy, slug, getDoc]);

  const stop = useCallback(() => {
    const turnId = turnIdRef.current;
    if (turnId) void fetch(`/buddy/api/turn/${turnId}/abort`, { method: "POST" }).catch(() => {});
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    void fetch("/buddy/api/thread/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: slug ?? "" }),
    }).catch(() => {});
    setItems([]);
    sfx.play("close");
  }, [slug]);

  return (
    <GlassPanel className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b hairline px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          <Sparkles size={13} className="text-[var(--color-neon-cyan)]" /> Buddy
        </span>
        <span className="flex items-center gap-1">
          {status && (
            <span className="text-muted mr-1 text-[10px]" title={`model: ${status.model} · knowledge: ${status.knowledge}${status.threads ? "" : " · threads don't persist (no mod-store)"}`}>
              {status.model} · {status.knowledge}
            </span>
          )}
          <button type="button" aria-label="New conversation" title="New conversation" className="text-muted rounded p-1 hover:bg-white/10 hover:text-[var(--fg)]" onClick={clear}>
            <RotateCcw size={13} />
          </button>
          <button type="button" aria-label="Close Buddy" title="Close" className="text-muted rounded p-1 hover:bg-white/10 hover:text-[var(--fg)]" onClick={onClose}>
            <X size={13} />
          </button>
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {items.length === 0 && (
          <p className="text-muted text-xs leading-relaxed">
            Describe a workflow and I'll draft it on your canvas — or ask me why a run failed. I read this app's docs and op
            catalog, validate before proposing, and you keep Save & Deploy.
          </p>
        )}
        {items.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div key={i} className="ml-6 rounded-lg bg-[color-mix(in_srgb,var(--color-neon-cyan)_12%,transparent)] px-3 py-2 text-sm">
                {item.text}
              </div>
            );
          }
          if (item.kind === "assistant") {
            return (
              <div key={i} className="text-sm leading-relaxed [&_pre]:overflow-x-auto [&_pre]:text-xs">
                <Markdown text={item.text} />
              </div>
            );
          }
          if (item.kind === "tool") {
            return (
              <button
                key={i}
                type="button"
                onClick={() => item.subRunId && navigate(`/runs/${item.subRunId}`)}
                title={item.error ?? (item.subRunId ? "Open the tool call's run" : item.toolName)}
                className={`flex items-center gap-1.5 rounded-full border hairline px-2.5 py-1 text-[11px] ${
                  item.phase === "error" ? "text-[var(--color-neon-amber)]" : "text-muted"
                } ${item.subRunId ? "hover:bg-white/5 hover:text-[var(--fg)]" : "cursor-default"}`}
              >
                {item.phase === "start" ? <Loader2 size={11} className="animate-spin" /> : item.phase === "error" ? <X size={11} /> : <Wrench size={11} />}
                {item.toolName.replace(/^pattern_/, "")}
                {item.subRunId && <ExternalLink size={10} />}
              </button>
            );
          }
          if (item.kind === "apply") {
            return (
              <div key={i} className="rounded-lg border hairline bg-white/[0.03] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold">{item.doc.name ?? item.doc.id}</span>
                  <span className="text-muted text-[10px]">
                    {item.doc.nodes?.length ?? 0} nodes · {item.doc.edges?.length ?? 0} edges
                    {item.valid === false ? " · invalid" : ""}
                  </span>
                </div>
                {item.summary && <p className="text-muted mb-2 text-xs">{item.summary}</p>}
                <NeonButton
                  variant={item.applied ? "ghost" : "solid"}
                  className="!px-3 !py-1 text-xs"
                  disabled={item.applied || item.valid === false}
                  onClick={() => {
                    onApply(item.doc);
                    setItems((prev) => prev.map((it, j) => (j === i && it.kind === "apply" ? { ...it, applied: true } : it)));
                    sfx.play("drop");
                  }}
                >
                  {item.applied ? (
                    <>
                      <Check size={12} /> Applied — review, then Save
                    </>
                  ) : (
                    "Apply to canvas"
                  )}
                </NeonButton>
              </div>
            );
          }
          return (
            <p key={i} className="text-muted text-xs italic">
              {item.text}
            </p>
          );
        })}
      </div>

      <div className="flex items-end gap-2 border-t hairline p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={Math.min(4, Math.max(1, input.split("\n").length))}
          placeholder={slug ? `Ask about "${slug}" or describe a change…` : "Describe the workflow you want…"}
          className="glass min-h-[34px] flex-1 resize-none rounded-lg px-3 py-1.5 text-sm outline-none"
        />
        {busy ? (
          <NeonButton variant="ghost" className="!px-2" aria-label="Stop" title="Stop this turn" onClick={stop}>
            <Square size={14} />
          </NeonButton>
        ) : (
          <NeonButton className="!px-2" aria-label="Send" title="Send (Enter)" onClick={() => void send()} disabled={!input.trim()}>
            <Send size={14} />
          </NeonButton>
        )}
      </div>
    </GlassPanel>
  );
}
