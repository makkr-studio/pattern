import type { PortInfo } from "@pattern/admin-sdk";

/** Human duration from (possibly fractional) milliseconds — the clock is
 *  high-res (sub-ms), so a fast node reads in µs instead of collapsing to 0. */
export function ms(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1) {
    const us = n * 1000;
    return us < 1 ? "<1µs" : `${Math.round(us)}µs`;
  }
  if (n < 10) return `${n.toFixed(2)}ms`;
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(2)}s`;
  return `${(n / 60000).toFixed(1)}m`;
}

/**
 * A run's duration label. For a streaming run the trace separates result-ready
 * (out-gates captured) from true-end (streams drained), so we show both —
 * "ready 40ms · streamed 3.2s" — instead of one misleading number. A run whose
 * streaming tail is negligible just reads as its total.
 */
export function runDuration(s: { durationMs?: number; readyMs?: number }): string {
  if (s.durationMs == null) return "—";
  if (s.readyMs != null && s.durationMs - s.readyMs > 2) {
    return `ready ${ms(s.readyMs)} · streamed ${ms(s.durationMs - s.readyMs)}`;
  }
  return ms(s.durationMs);
}

/** Relative time from an epoch-ms timestamp. */
export function ago(epochMs: number): string {
  const s = (Date.now() - epochMs) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** CSS var for a port kind's semantic color (shared editor↔runtime). */
export function portColor(kind: PortInfo["kind"]): string {
  return kind === "value"
    ? "var(--color-port-value)"
    : kind === "stream"
      ? "var(--color-port-stream)"
      : "var(--color-port-control)";
}

/** The primary JSON-Schema type carried by a port ("any" when untyped). */
export function schemaTypeOf(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema as { type?: string | string[]; anyOf?: unknown[]; enum?: unknown[] };
  if (s.enum) return "enum";
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "integer") return "number";
  if (typeof t === "string") return t;
  if (s.anyOf) return "union";
  return "any";
}

/** Data-type colors for port dots — one hue per JSON type, shared everywhere. */
const TYPE_COLORS: Record<string, string> = {
  string: "var(--color-type-string)",
  number: "var(--color-type-number)",
  boolean: "var(--color-type-boolean)",
  object: "var(--color-type-object)",
  array: "var(--color-type-array)",
  enum: "var(--color-type-string)",
  union: "var(--color-type-any)",
  null: "var(--color-port-control)",
  any: "var(--color-type-any)",
};

/**
 * The color of one specific port: control = grey, stream = violet (the kind is
 * the headline for streams), value = colored by its data type.
 */
export function portFill(p: Pick<PortInfo, "kind" | "schema">): string {
  if (p.kind === "control") return "var(--color-port-control)";
  if (p.kind === "stream") return "var(--color-port-stream)";
  return TYPE_COLORS[schemaTypeOf(p.schema)] ?? "var(--color-type-any)";
}

/** A short human type label for a port ("value<string>", "stream<any>", "control"). */
export function portTypeLabel(p: Pick<PortInfo, "kind" | "schema">): string {
  if (p.kind === "control") return "control";
  return `${p.kind}<${schemaTypeOf(p.schema)}>`;
}

const STATUS_COLORS: Record<string, string> = {
  ok: "var(--color-neon-lime)",
  error: "var(--color-neon-pink)",
  running: "var(--color-neon-cyan)",
  streaming: "var(--color-port-stream)",
  skipped: "var(--color-port-control)",
  unset: "var(--color-port-control)",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "var(--color-port-control)";
}

/** Short, stable color for a category/source badge (deterministic hash → hue). */
export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
