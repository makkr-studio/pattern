import type { PortInfo } from "@pattern/admin-sdk";

/** Human duration from milliseconds. */
export function ms(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1) return "<1ms";
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(2)}s`;
  return `${(n / 60000).toFixed(1)}m`;
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

const STATUS_COLORS: Record<string, string> = {
  ok: "var(--color-neon-lime)",
  error: "var(--color-neon-pink)",
  running: "var(--color-neon-cyan)",
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
