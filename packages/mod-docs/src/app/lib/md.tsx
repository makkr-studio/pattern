/**
 * The docs markdown renderer — an EXTENDED sibling of mod-chat's md.tsx
 * (kept separate on purpose: chat's stays minimal and model-output-hardened).
 * Same construction principle — React elements only, no innerHTML — plus the
 * documentation subset: tables, images, h1–h6 with anchor ids, hr, nested
 * emphasis, internal `.md` link rewriting, and a fence hook so hosts can
 * render special blocks (```workflow → a live read-only graph).
 */

import React from "react";

type Node = React.ReactNode;

export interface MdOptions {
  /** Rewrite a link target; `internal: true` renders a router link instead of <a target=_blank>. */
  resolveLink?: (href: string) => { href: string; internal?: boolean };
  /** Render a fenced block (lang, body). Return null to fall back to <pre>. */
  fence?: (lang: string, body: string, key: string) => Node | null;
  /** Internal links render through this (e.g. react-router's Link). */
  InternalLink?: React.ComponentType<{ to: string; children: React.ReactNode }>;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Headings of a markdown body (for TOC rails) — fences excluded. */
export function headingsOf(text: string): Array<{ depth: number; text: string; id: string }> {
  const out: Array<{ depth: number; text: string; id: string }> = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) out.push({ depth: m[1]!.length, text: m[2]!.replace(/`/g, ""), id: slugifyHeading(m[2]!) });
  }
  return out;
}

function inline(text: string, keyBase: string, opts: MdOptions): Node[] {
  const out: Node[] = [];
  // tokens: `code`, **bold**, *italic*, ![alt](src), [label](url)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={key}>{inline(tok.slice(2, -2), key, opts)}</strong>);
    else if (tok.startsWith("*")) out.push(<em key={key}>{inline(tok.slice(1, -1), key, opts)}</em>);
    else if (tok.startsWith("!")) {
      const im = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(<img key={key} src={im[2]} alt={im[1]} loading="lazy" />);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const resolved = opts.resolveLink?.(lm[2]!) ?? { href: lm[2]! };
      if (resolved.internal && opts.InternalLink) {
        const I = opts.InternalLink;
        out.push(
          <I key={key} to={resolved.href}>
            {lm[1]}
          </I>,
        );
      } else {
        const external = /^https?:\/\//.test(resolved.href);
        out.push(
          <a key={key} href={resolved.href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
            {lm[1]}
          </a>,
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableSep = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ text, ...opts }: { text: string } & MdOptions): React.ReactElement {
  const blocks: Node[] = [];
  const lines = text.split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const fence: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) fence.push(lines[i++]!);
      i++; // closing fence (or EOF)
      const body = fence.join("\n");
      const custom = lang ? opts.fence?.(lang, body, `f${k}`) : null;
      blocks.push(
        custom ?? (
          <pre key={k++} data-lang={lang || undefined}>
            <code>{body}</code>
          </pre>
        ),
      );
      if (custom) k++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const depth = h[1]!.length;
      const H = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[depth - 1]!;
      const id = slugifyHeading(h[2]!);
      blocks.push(
        React.createElement(
          H,
          { key: k++, id, className: "group" },
          inline(h[2]!, `h${k}`, opts),
          depth > 1 && (
            <a href={`#${id}`} className="heading-anchor" aria-label="Link to this section">
              #
            </a>
          ),
        ),
      );
      i++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={k++} />);
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(splitRow(lines[i++]!));
      blocks.push(
        <div key={k++} className="table-wrap">
          <table>
            <thead>
              <tr>
                {header.map((c, j) => (
                  <th key={j}>{inline(c, `th${k}-${j}`, opts)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j}>{inline(c, `td${k}-${r}-${j}`, opts)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]!) || /^\s{2,}\S/.test(lines[i]!))) {
        if (/^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ""));
        else items[items.length - 1] = `${items[items.length - 1]} ${lines[i]!.trim()}`; // hanging indent
        i++;
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(
        React.createElement(
          L,
          { key: k++ },
          items.map((it, j) => <li key={j}>{inline(it, `li${k}-${j}`, opts)}</li>),
        ),
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) quote.push(lines[i++]!.slice(2));
      blocks.push(<blockquote key={k++}>{inline(quote.join(" "), `q${k}`, opts)}</blockquote>);
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph: gather until a blank or a structural line
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]!) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!) &&
      !lines[i]!.startsWith("> ") &&
      !isTableRow(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`, opts)}</p>);
  }

  return <div className="prose-docs">{blocks}</div>;
}
