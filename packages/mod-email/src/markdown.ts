/**
 * @pattern-js/mod-email — markdown → email HTML + plain-text alternative.
 *
 * Email clients ignore stylesheets, so every style is inline and the subset is
 * deliberately small: headings, paragraphs, fenced code, lists, bold/italic/
 * code spans, links (+ bare-URL autolink). One email-specific rule: a paragraph
 * that is EXACTLY one link renders as a button — the "click the button" line in
 * a sign-in email costs nothing to author. Only http/https/mailto hrefs survive
 * (a `javascript:` link renders as plain text). Zero dependencies on purpose:
 * this is the provider-independent part of sending decent email, and it belongs
 * to the contract mod.
 */

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const S = {
  wrap: `max-width:560px;margin:0 auto;padding:24px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1a1a1a;`,
  h1: `margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;`,
  h2: `margin:20px 0 8px;font-size:18px;line-height:1.35;font-weight:700;`,
  h3: `margin:16px 0 6px;font-size:15px;line-height:1.4;font-weight:700;`,
  p: `margin:0 0 12px;`,
  a: `color:#2563eb;text-decoration:underline;`,
  button: `display:inline-block;padding:12px 20px;border-radius:8px;background:#111111;color:#ffffff;text-decoration:none;font-weight:600;`,
  code: `font-family:${MONO};font-size:13px;background:#f4f4f5;border-radius:4px;padding:1px 5px;`,
  pre: `margin:0 0 12px;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-family:${MONO};font-size:13px;line-height:1.5;overflow:auto;white-space:pre-wrap;`,
  list: `margin:0 0 12px;padding-left:24px;`,
} as const;

const SAFE_HREF = /^(https?:|mailto:)/i;
// After HTML-escaping, `&` in a URL reads `&amp;` — fine inside an attribute.
const URL_RE = /https?:\/\/[^\s<>"')]+/g;
// Placeholder delimiter for protected inline spans; stripped from input first.
const NUL = "\u0000";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── block model ───────────────────────────────────────────────────────── */

type Block =
  | { kind: "heading"; depth: 1 | 2 | 3; text: string }
  | { kind: "para"; text: string }
  | { kind: "code"; body: string }
  | { kind: "list"; ordered: boolean; items: string[] };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code — verbatim until the closing fence.
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ kind: "code", body: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", depth: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      i++;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    // Paragraph: consecutive non-blank, non-structural lines join with spaces.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]!)) {
      para.push(lines[i]!.trim());
      i++;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
  }
  return blocks;
}

/* ── inline rendering (on escaped text) ────────────────────────────────── */

function renderInline(escaped: string): string {
  // Protect code spans (and built anchors) from further formatting with
  // NUL-delimited placeholders — NUL can't survive in the input (stripped).
  const stash: string[] = [];
  const keep = (html: string): string => `${NUL}${stash.push(html) - 1}${NUL}`;

  let s = escaped.replace(/`([^`]+)`/g, (_, code: string) => keep(`<code style="${S.code}">${code}</code>`));

  // [text](url) — unsafe schemes render as their text, not a link.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) =>
    SAFE_HREF.test(href) ? keep(`<a href="${href}" style="${S.a}">${text}</a>`) : text,
  );

  // Bare URLs autolink.
  s = s.replace(URL_RE, (url) => keep(`<a href="${url}" style="${S.a}">${url}</a>`));

  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\W)\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|\W)_([^_\s][^_]*)_/g, "$1<em>$2</em>");

  return s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => stash[Number(n)]!);
}

/** The button rule: a paragraph that is exactly one link (or one bare URL). */
function soleLink(text: string): { href: string; label: string } | undefined {
  const t = text.trim();
  const linked = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
  if (linked && SAFE_HREF.test(linked[2]!)) return { href: linked[2]!, label: linked[1]! };
  if (/^https?:\/\/\S+$/.test(t)) return { href: t, label: t };
  return undefined;
}

/* ── text alternative ──────────────────────────────────────────────────── */

function inlineText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => (label === href ? href : `${label} (${href})`))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/(^|\W)_([^_\s][^_]*)_/g, "$1$2");
}

/* ── public API ────────────────────────────────────────────────────────── */

export function renderEmailMarkdown(md: string): { html: string; text: string } {
  const blocks = parseBlocks(md.replaceAll(NUL, ""));

  const html = blocks
    .map((b) => {
      switch (b.kind) {
        case "heading": {
          const tag = `h${b.depth}` as const;
          return `<${tag} style="${S[tag]}">${renderInline(escapeHtml(b.text))}</${tag}>`;
        }
        case "code":
          return `<pre style="${S.pre}">${escapeHtml(b.body)}</pre>`;
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          const items = b.items.map((it) => `<li>${renderInline(escapeHtml(it))}</li>`).join("");
          return `<${tag} style="${S.list}">${items}</${tag}>`;
        }
        case "para": {
          const button = soleLink(b.text);
          if (button) {
            return `<p style="${S.p}"><a href="${escapeHtml(button.href)}" style="${S.button}">${escapeHtml(button.label)}</a></p>`;
          }
          return `<p style="${S.p}">${renderInline(escapeHtml(b.text))}</p>`;
        }
      }
    })
    .join("\n");

  const text = blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return inlineText(b.text);
        case "code":
          return b.body;
        case "list":
          return b.items.map((it, i) => (b.ordered ? `${i + 1}. ${inlineText(it)}` : `- ${inlineText(it)}`)).join("\n");
        case "para":
          return inlineText(b.text);
      }
    })
    .join("\n\n");

  return { html: `<div style="${S.wrap}">\n${html}\n</div>`, text };
}
