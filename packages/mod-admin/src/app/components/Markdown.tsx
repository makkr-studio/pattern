import type { ReactNode } from "react";

/** Inline markdown: `code`, **bold**, *italic*. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on `code` spans first (highest precedence).
  text.split(/(`[^`]+`)/g).forEach((seg, i) => {
    if (seg.startsWith("`") && seg.endsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">
          {seg.slice(1, -1)}
        </code>,
      );
      return;
    }
    // Then **bold** and *italic* within the non-code text.
    seg.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).forEach((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) out.push(<strong key={`${keyBase}-b${i}-${j}`}>{part.slice(2, -2)}</strong>);
      else if (part.startsWith("*") && part.endsWith("*")) out.push(<em key={`${keyBase}-i${i}-${j}`}>{part.slice(1, -1)}</em>);
      else if (part) out.push(<span key={`${keyBase}-t${i}-${j}`}>{part}</span>);
    });
  });
  return out;
}

/** A minimal markdown renderer for op descriptions / node comments (one-liners
 *  to a few lines): paragraphs, `- ` bullets, inline code/bold/italic. */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <div className={`space-y-1 leading-relaxed ${className}`}>
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (t === "") return null;
        if (t.startsWith("- "))
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-muted">•</span>
              <span>{inline(t.slice(2), `l${i}`)}</span>
            </div>
          );
        return <p key={i}>{inline(t, `l${i}`)}</p>;
      })}
    </div>
  );
}
