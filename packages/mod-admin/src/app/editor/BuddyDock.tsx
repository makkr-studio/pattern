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
import { Check, ExternalLink, Loader2, RotateCcw, Send, Sparkles, Square, TriangleAlert, Wrench, X } from "lucide-react";

type DockItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; toolName: string; phase: "start" | "done" | "error"; subRunId?: string; error?: string }
  | { kind: "apply"; doc: WorkflowDoc; summary: string; valid: boolean | null; applied: boolean }
  | { kind: "note"; text: string };

type ToolCall = Extract<DockItem, { kind: "tool" }>;

/**
 * The display list: CONSECUTIVE calls of the same tool collapse into one chip
 * with a "+n" badge (a research-y turn calls pattern_search_docs four times in
 * a row — that's one activity, not four rows). `idx` keeps each non-grouped
 * item's position in `items`, which in-place patches (the Apply card) need.
 */
type DisplayEntry =
  | { kind: "entry"; item: Exclude<DockItem, ToolCall>; idx: number }
  | { kind: "tools"; toolName: string; calls: ToolCall[] };

function toDisplay(items: DockItem[]): DisplayEntry[] {
  const out: DisplayEntry[] = [];
  items.forEach((item, idx) => {
    if (item.kind === "tool") {
      const last = out.at(-1);
      if (last?.kind === "tools" && last.toolName === item.toolName) last.calls.push(item);
      else out.push({ kind: "tools", toolName: item.toolName, calls: [item] });
    } else {
      out.push({ kind: "entry", item, idx });
    }
  });
  return out;
}

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

interface FailedRun {
  runId: string;
  workflowId: string;
  startTime: number;
}

/** "3m ago" / "2h ago" / "1d ago" — chip-sized recency. */
function ago(ts: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours <= 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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
  const [failedRun, setFailedRun] = useState<FailedRun | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The one-click debug moment: surface the most recent failed run (recent =
  // last 24h; the admin's own plumbing routes don't count) as a chip that
  // sends the "why did this fail" question for you.
  const checkFailures = useCallback(() => {
    void fetch("/admin/api/runs?status=error&limit=10")
      .then((r) => (r.ok ? r.json() : []))
      .then((runs: FailedRun[] | unknown) => {
        const recent = (Array.isArray(runs) ? (runs as FailedRun[]) : []).find(
          (r) =>
            !r.workflowId.startsWith("__") &&
            !r.workflowId.includes(".route.admin.") &&
            Date.now() - r.startTime < 24 * 60 * 60 * 1000,
        );
        setFailedRun(recent ?? null);
      })
      .catch(() => {});
  }, []);

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
    checkFailures();
    return () => {
      live = false;
    };
  }, [slug, checkFailures]);

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

  const sendMessage = useCallback(async (message: string) => {
    if (!message || busy) return;
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
      checkFailures(); // the turn may have run (or fixed) something
    }
  }, [busy, slug, getDoc, checkFailures]);

  const send = useCallback(() => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    void sendMessage(message);
  }, [input, busy, sendMessage]);

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
        {toDisplay(items).map((entry, i) => {
          if (entry.kind === "tools") {
            const { toolName, calls } = entry;
            const running = calls.some((c) => c.phase === "start");
            const errored = calls.find((c) => c.phase === "error");
            const latestRun = [...calls].reverse().find((c) => c.subRunId)?.subRunId;
            return (
              <button
                key={i}
                type="button"
                onClick={() => latestRun && navigate(`/runs/${latestRun}`)}
                title={
                  errored?.error ??
                  (latestRun ? (calls.length > 1 ? `${calls.length} calls — open the latest run` : "Open the tool call's run") : toolName)
                }
                className={`flex items-center gap-1.5 rounded-full border hairline px-2.5 py-1 text-[11px] ${
                  errored ? "text-[var(--color-neon-amber)]" : "text-muted"
                } ${latestRun ? "hover:bg-white/5 hover:text-[var(--fg)]" : "cursor-default"}`}
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : errored ? <X size={11} /> : <Wrench size={11} />}
                {toolName.replace(/^pattern_/, "")}
                {calls.length > 1 && (
                  <span className="rounded-full bg-white/10 px-1.5 text-[10px] leading-4">+{calls.length - 1}</span>
                )}
                {latestRun && <ExternalLink size={10} />}
              </button>
            );
          }
          const { item, idx } = entry;
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
                    // `idx` is the position in `items` — the display list regroups.
                    setItems((prev) => prev.map((it, j) => (j === idx && it.kind === "apply" ? { ...it, applied: true } : it)));
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
        {failedRun && !busy && (
          <button
            type="button"
            onClick={() => {
              const question = `The last run of "${failedRun.workflowId}" failed (run ${failedRun.runId}). Why, and how do I fix it?`;
              setFailedRun(null);
              void sendMessage(question);
            }}
            className="flex w-full items-center gap-1.5 rounded-lg border hairline bg-[color-mix(in_srgb,var(--color-neon-amber)_8%,transparent)] px-2.5 py-1.5 text-left text-[11px] text-[var(--color-neon-amber)] hover:bg-[color-mix(in_srgb,var(--color-neon-amber)_16%,transparent)]"
          >
            <TriangleAlert size={12} className="shrink-0" />
            <span className="truncate">
              Why did “{failedRun.workflowId}” fail {ago(failedRun.startTime)}?
            </span>
          </button>
        )}
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
