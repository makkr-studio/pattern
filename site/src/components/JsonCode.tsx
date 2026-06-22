import { type ReactNode } from "react";

/**
 * JSON syntax highlighting — no editor dependency. Tokenizes JSON-ish text into
 * colored spans using the same palette as the product. Lifted from the admin
 * (the read-only highlight path; the editable textarea variant is not needed here).
 */

const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])/g;

/** Tokenize JSON-ish text into colored spans (best-effort). */
export function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <span key={k++} style={{ color: "var(--color-neon-cyan)" }}>
          {m[1]}
        </span>,
        m[2],
      );
    } else if (m[3] !== undefined) {
      out.push(
        <span key={k++} style={{ color: "var(--color-type-string)" }}>
          {m[3]}
        </span>,
      );
    } else if (m[4] !== undefined) {
      out.push(
        <span key={k++} style={{ color: "var(--color-type-number)" }}>
          {m[4]}
        </span>,
      );
    } else if (m[5] !== undefined) {
      out.push(
        <span key={k++} style={{ color: "var(--color-type-boolean)" }}>
          {m[5]}
        </span>,
      );
    } else if (m[6] !== undefined) {
      out.push(
        <span key={k++} style={{ color: "var(--color-neon-violet)" }}>
          {m[6]}
        </span>,
      );
    } else if (m[7] !== undefined) {
      out.push(
        <span key={k++} className="opacity-60">
          {m[7]}
        </span>,
      );
    }
    last = TOKEN.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
