import type { SpanData } from "@pattern/admin-sdk";
import type { ReplayState } from "../editor/graph";

/**
 * Replay is driven by an ordered EVENT LOG, not by reconstructing a timeline
 * from each span's [start,end] bar. Every node contributes its started /
 * per-output / per-stream-chunk / ended moments; the scrubber steps through that
 * flat, time-sorted list. Stepping by event index is symmetric by construction —
 * N forward then N back returns to where you were.
 */

export type ReplayEventKind = "started" | "output" | "chunk" | "ended" | "skipped";

export interface ReplayEvent {
  kind: ReplayEventKind;
  node: string;
  port?: string;
  seq?: number;
  preview?: unknown;
  truncated?: boolean;
  sampled?: boolean;
  status?: ReplayState;
  /** Offset from the run's t0, in (possibly fractional) ms. */
  at: number;
}

export function nodeIdOf(span: SpanData): string | undefined {
  const id = span.attributes["pattern.node.id"];
  return typeof id === "string" ? id : undefined;
}

/** Legacy fallback for runs captured before the scheduler emitted a `started`
 *  event: a node launches at t≈0 and blocks on its inputs, so shift past the
 *  measured blocked prefix. */
function effectiveStart(span: SpanData): number {
  return span.startTime + Number(span.attributes["pattern.node.blockedMs"] ?? 0);
}

/** The measured instant the node began working — the explicit `started` event
 *  (backdated to the real unblock time) when present, else the heuristic. */
export function startedAt(span: SpanData): number {
  const ev = span.events?.find((e) => e.name === "started");
  return ev ? ev.time : effectiveStart(span);
}

/** Per-node replay state at an absolute epoch-ms instant (`t0 + offset`). */
export function stateAt(span: SpanData, now: number): ReplayState {
  if (now < startedAt(span)) return "pending";
  if (now < span.endTime) return "running";
  if (span.events?.some((e) => e.name === "skipped")) return "skipped";
  return span.status === "error" ? "error" : "ok";
}

/** Flatten node spans into one time-sorted event log (offsets from `t0`). */
export function buildReplayEvents(nodeSpans: SpanData[], t0: number): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const s of nodeSpans) {
    const node = nodeIdOf(s);
    if (!node) continue;
    out.push({ kind: "started", node, at: Math.max(0, startedAt(s) - t0) });
    for (const e of s.events ?? []) {
      if (e.name === "output") {
        out.push({ kind: "output", node, port: String(e.attributes?.port ?? ""), at: Math.max(0, e.time - t0) });
      } else if (e.name === "stream.chunk") {
        const a = e.attributes ?? {};
        out.push({
          kind: "chunk",
          node,
          port: String(a.port ?? ""),
          seq: Number(a.seq ?? 0),
          preview: a.preview,
          truncated: Boolean(a.truncated),
          sampled: Boolean(a.sampled),
          at: Math.max(0, e.time - t0),
        });
      }
    }
    const skipped = s.events?.some((e) => e.name === "skipped");
    out.push({
      kind: skipped ? "skipped" : "ended",
      node,
      status: skipped ? "skipped" : s.status === "error" ? "error" : "ok",
      at: Math.max(0, s.endTime - t0),
    });
  }
  // Stable sort by time; the index tiebreak keeps `started` before `ended` at t≈0.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    .map((o) => o.e);
}

/** The first event strictly after `t` (or `total` at the end). Symmetric with
 *  {@link stepBack}: same-instant events are one stop. */
export function stepForward(events: ReplayEvent[], t: number, total: number): number {
  return events.find((e) => e.at > t)?.at ?? total;
}

/** The last event strictly before `t` (or 0 at the start). */
export function stepBack(events: ReplayEvent[], t: number): number {
  let prev = 0;
  for (const e of events) {
    if (e.at < t) prev = e.at;
    else break;
  }
  return prev;
}
