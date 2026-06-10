import { highlight } from "./JsonCode";

/**
 * A colored line diff for JSON values (the Versions screen). Classic LCS over
 * pretty-printed lines: unchanged lines render plain, removals red, additions
 * green, with old/new line numbers in a dual gutter. Dependency-free — config
 * diffs are small, so the O(n·m) table is fine (guarded with a fallback).
 */

export interface DiffRow {
  type: "same" | "del" | "add";
  text: string;
  /** 1-based line number in the BEFORE text (del/same). */
  a?: number;
  /** 1-based line number in the AFTER text (add/same). */
  b?: number;
}

/** LCS line diff; falls back to "all del + all add" beyond ~250k cells. */
export function diffLines(beforeText: string, afterText: string): DiffRow[] {
  const a = beforeText.split("\n");
  const b = afterText.split("\n");
  if (a.length * b.length > 250_000) {
    return [
      ...a.map((text, i) => ({ type: "del" as const, text, a: i + 1 })),
      ...b.map((text, i) => ({ type: "add" as const, text, b: i + 1 })),
    ];
  }
  // dp[i][j] = LCS length of a[i:] vs b[j:]
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i]!, a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ type: "del", text: a[i]!, a: i + 1 });
      i++;
    } else {
      rows.push({ type: "add", text: b[j]!, b: j + 1 });
      j++;
    }
  }
  while (i < a.length) rows.push({ type: "del", text: a[i]!, a: ++i });
  while (j < b.length) rows.push({ type: "add", text: b[j]!, b: ++j });
  return rows;
}

const ROW_STYLE: Record<DiffRow["type"], React.CSSProperties> = {
  same: {},
  del: { background: "color-mix(in srgb, var(--color-neon-pink) 14%, transparent)" },
  add: { background: "color-mix(in srgb, var(--color-neon-lime) 12%, transparent)" },
};
const MARK: Record<DiffRow["type"], string> = { same: " ", del: "−", add: "+" };
const MARK_COLOR: Record<DiffRow["type"], string> = {
  same: "transparent",
  del: "var(--color-neon-pink)",
  add: "var(--color-neon-lime)",
};

/** Side-aware unified diff of two JSON values (or raw strings). */
export function JsonDiff({ before, after, className = "" }: { before: unknown; after: unknown; className?: string }) {
  const toText = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : (JSON.stringify(v, null, 2) ?? ""));
  const rows = diffLines(toText(before), toText(after));
  return (
    <div className={`glass overflow-auto rounded-xl font-mono text-xs leading-relaxed ${className}`}>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={ROW_STYLE[r.type]}>
              <td className="w-8 select-none border-r hairline pr-2 text-right align-top text-[var(--fg-muted)] opacity-60">{r.a ?? ""}</td>
              <td className="w-8 select-none border-r hairline pr-2 text-right align-top text-[var(--fg-muted)] opacity-60">{r.b ?? ""}</td>
              <td className="w-5 select-none text-center align-top font-semibold" style={{ color: MARK_COLOR[r.type] }}>
                {MARK[r.type]}
              </td>
              <td className="whitespace-pre pr-3 align-top">{highlight(r.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
