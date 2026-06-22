import { portColor } from "../lib/format";

const ITEMS: { kind: "value" | "stream" | "control"; label: string; note: string }[] = [
  { kind: "value", label: "value", note: "a single resolved value" },
  { kind: "stream", label: "stream", note: "a flow of chunks" },
  { kind: "control", label: "control", note: "a dataless pulse" },
];

/** The three edge kinds, color-coded like the editor. */
export function EdgeLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm ${className}`}>
      {ITEMS.map((i) => (
        <span key={i.kind} className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: portColor(i.kind), boxShadow: `0 0 8px ${portColor(i.kind)}` }} />
          <span className="font-mono">{i.label}</span>
          <span className="text-muted">{i.note}</span>
        </span>
      ))}
    </div>
  );
}
