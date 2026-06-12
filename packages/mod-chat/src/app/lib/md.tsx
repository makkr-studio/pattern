/**
 * A compact markdown renderer producing React elements — no innerHTML, so
 * model output can't smuggle markup (XSS-safe by construction). Covers the
 * chat-relevant subset: paragraphs, fenced code, inline code, bold/italic,
 * links, lists, headings, blockquotes.
 */

import React from "react";

type Node = React.ReactNode;

function inline(text: string, keyBase: string): Node[] {
  const out: Node[] = [];
  // tokens: `code`, **bold**, *italic*, [label](url)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    else if (tok.startsWith("*")) out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(
        <a key={key} href={lm[2]} target="_blank" rel="noreferrer noopener">
          {lm[1]}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }): React.ReactElement {
  const blocks: Node[] = [];
  const lines = text.split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("```")) {
      const fence: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) fence.push(lines[i++]!);
      i++; // closing fence (or EOF)
      blocks.push(
        <pre key={k++}>
          <code>{fence.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const H = (["h1", "h2", "h3"] as const)[h[1]!.length - 1]!;
      blocks.push(React.createElement(H, { key: k++ }, inline(h[2]!, `h${k}`)));
      i++;
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(
        React.createElement(
          L,
          { key: k++ },
          items.map((it, j) => <li key={j}>{inline(it, `li${k}-${j}`)}</li>),
        ),
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) quote.push(lines[i++]!.slice(2));
      blocks.push(<blockquote key={k++}>{inline(quote.join(" "), `q${k}`)}</blockquote>);
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
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!) &&
      !lines[i]!.startsWith("> ")
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`)}</p>);
  }

  return <div className="prose-chat">{blocks}</div>;
}
