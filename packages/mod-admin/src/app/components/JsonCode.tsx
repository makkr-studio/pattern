import { useRef, type ReactNode } from "react";

/**
 * A JSON code field with syntax highlighting and live validity — no editor
 * dependency. Classic overlay: a highlighted <pre> sits under a transparent
 * <textarea>; both share the exact same typography so the caret lands on the
 * colored glyphs. Parse status (with line/column) renders underneath.
 */

const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])/g;

/** Tokenize JSON-ish text into colored spans (best-effort while typing). */
export function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      // "key":
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

export type JsonStatus = { ok: true; empty: boolean } | { ok: false; message: string; line?: number; col?: number };

/** Parse status with a line/column extracted from the engine's error message. */
export function jsonStatus(text: string): JsonStatus {
  if (!text.trim()) return { ok: true, empty: true };
  try {
    JSON.parse(text);
    return { ok: true, empty: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // V8: "... at position 42 (line 3 column 5)" or "... at position 42".
    const lineCol = /line (\d+) column (\d+)/.exec(msg);
    const pos = /position (\d+)/.exec(msg);
    let line: number | undefined;
    let col: number | undefined;
    if (lineCol) {
      line = Number(lineCol[1]);
      col = Number(lineCol[2]);
    } else if (pos) {
      const upTo = text.slice(0, Number(pos[1]));
      line = upTo.split("\n").length;
      col = upTo.length - upTo.lastIndexOf("\n");
    }
    return { ok: false, message: msg.replace(/^JSON\.parse: |^Unexpected token /, "").split(" in JSON")[0]!, line, col };
  }
}

// The pre and the textarea MUST share these exactly — that's the whole trick.
// No soft wrap: one logical line = one visual line, so the gutter stays true.
const TYPO = "py-2 pr-2 pl-2 font-mono text-xs leading-relaxed whitespace-pre";

export function JsonCode({
  text,
  onText,
  onBlur,
  height = "h-40",
  placeholder,
  invalid,
  plainOk,
  ariaLabel,
}: {
  text: string;
  onText: (t: string) => void;
  onBlur?: () => void;
  /** Tailwind height class, e.g. "h-40". */
  height?: string;
  placeholder?: string;
  /** Extra invalid signal from the owner (e.g. "valid JSON but wrong shape"). */
  invalid?: boolean;
  /** Non-JSON text is acceptable here (sent as a plain string) — inform, don't warn. */
  plainOk?: boolean;
  ariaLabel?: string;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const status = jsonStatus(text);
  const bad = invalid || (!status.ok && !plainOk);
  const lineCount = Math.max(1, text.split("\n").length);

  return (
    <div>
      <div className={`glass flex w-full overflow-hidden rounded-lg ${bad ? "ring-1 ring-[var(--color-neon-amber)]" : ""}`}>
        {/* Line-number gutter — same typography, scroll-synced to the textarea. */}
        <pre
          ref={gutterRef}
          aria-hidden
          className={`${TYPO} ${height} w-8 shrink-0 select-none overflow-hidden border-r hairline text-right text-[var(--fg-muted)] opacity-60`}
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
          {"\n"}
        </pre>
        <div className="relative min-w-0 flex-1">
          <pre ref={preRef} aria-hidden className={`${TYPO} ${height} pointer-events-none w-full overflow-auto`}>
            {highlight(text)}
            {"\n" /* breathing room so the last line scrolls fully into view */}
          </pre>
          <textarea
            value={text}
            spellCheck={false}
            wrap="off"
            aria-label={ariaLabel ?? "JSON"}
            aria-invalid={bad}
            placeholder={placeholder}
            onChange={(e) => onText(e.target.value)}
            onBlur={onBlur}
            onScroll={(e) => {
              if (preRef.current) {
                preRef.current.scrollTop = e.currentTarget.scrollTop;
                preRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            className={`${TYPO} absolute inset-0 ${height} w-full resize-none overflow-auto bg-transparent text-transparent caret-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)] selection:bg-[var(--color-neon-cyan)]/25`}
          />
        </div>
      </div>
      {/* Live parse status */}
      {!status.ok ? (
        plainOk ? (
          <div className="text-muted mt-1 text-[10px]">plain text — sent as a string</div>
        ) : (
          <div className="mt-1 text-[10px] text-[var(--color-neon-amber)]">
            ⚠ {status.line != null ? `Ln ${status.line}, Col ${status.col} — ` : ""}
            {status.message}
          </div>
        )
      ) : (
        !status.empty && <div className="mt-1 text-[10px] text-[var(--color-neon-lime)] opacity-70">✓ valid JSON</div>
      )}
    </div>
  );
}
