import type { ReactNode } from "react";

/** Inline markdown: `code`, **bold**, *italic*, [links](url). */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on `code` spans first (highest precedence), then links, then emphasis.
  text.split(/(`[^`]+`)/g).forEach((seg, i) => {
    if (seg.startsWith("`") && seg.endsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">
          {seg.slice(1, -1)}
        </code>,
      );
      return;
    }
    seg.split(/(\[[^\]]+\]\([^)]+\))/g).forEach((part, j) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        out.push(
          <a key={`${keyBase}-a${i}-${j}`} href={link[2]} target="_blank" rel="noreferrer" className="text-[var(--color-neon-cyan)] underline">
            {link[1]}
          </a>,
        );
        return;
      }
      part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).forEach((p, k) => {
        if (p.startsWith("**") && p.endsWith("**")) out.push(<strong key={`${keyBase}-b${i}-${j}-${k}`}>{p.slice(2, -2)}</strong>);
        else if (p.startsWith("*") && p.endsWith("*")) out.push(<em key={`${keyBase}-i${i}-${j}-${k}`}>{p.slice(1, -1)}</em>);
        else if (p) out.push(<span key={`${keyBase}-t${i}-${j}-${k}`}>{p}</span>);
      });
    });
  });
  return out;
}

const HEADING_CLS: Record<number, string> = {
  1: "text-base font-semibold mt-2 first:mt-0",
  2: "text-sm font-semibold mt-2 first:mt-0",
  3: "text-[0.85em] font-semibold uppercase tracking-wider text-muted mt-2 first:mt-0",
};

/**
 * A small dependency-free markdown renderer for op descriptions / node comments:
 * headings (#/##/###+), bullet + numbered lists, fenced code blocks, block
 * quotes, horizontal rules, and inline code/bold/italic/links.
 */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "") continue;

    // ``` fenced code block — verbatim until the closing fence.
    if (t.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i]!), i++;
      blocks.push(
        <pre key={`f${i}`} className="overflow-x-auto rounded-lg bg-black/30 p-2 font-mono text-[0.85em] leading-relaxed">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    // # headings (deeper than ### renders as ###).
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const level = Math.min(h[1]!.length, 3);
      blocks.push(
        <div key={`h${i}`} role="heading" aria-level={h[1]!.length} className={HEADING_CLS[level]}>
          {inline(h[2]!, `h${i}`)}
        </div>,
      );
      continue;
    }

    // --- horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push(<hr key={`r${i}`} className="border-0 border-t hairline" />);
      continue;
    }

    // > block quote
    if (t.startsWith("> ")) {
      blocks.push(
        <blockquote key={`q${i}`} className="border-l-2 border-[var(--color-neon-cyan)] pl-2 opacity-80">
          {inline(t.slice(2), `q${i}`)}
        </blockquote>,
      );
      continue;
    }

    // - bullets / 1. numbered items
    const num = /^(\d+)[.)]\s+(.*)$/.exec(t);
    if (t.startsWith("- ") || t.startsWith("* ") || num) {
      blocks.push(
        <div key={`l${i}`} className="flex gap-1.5">
          <span className="text-muted shrink-0">{num ? `${num[1]}.` : "•"}</span>
          <span>{inline(num ? num[2]! : t.slice(2), `l${i}`)}</span>
        </div>,
      );
      continue;
    }

    blocks.push(<p key={`p${i}`}>{inline(t, `p${i}`)}</p>);
  }

  return <div className={`space-y-1 leading-relaxed ${className}`}>{blocks}</div>;
}
