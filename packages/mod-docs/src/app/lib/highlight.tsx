/**
 * A tiny syntax highlighter — React elements, no innerHTML (XSS-safe by
 * construction, like the markdown renderer). Hand-rolled rather than pulling
 * in shiki/prism: docs code blocks are JSON, JS/TS, and shell, and a ~120-line
 * lexer covers them without a heavyweight dependency in the reading bundle.
 * Colors are theme-aware CSS vars (--hl-*).
 */

import React from "react";

type Lang = "json" | "js" | "sh" | "text";

function normLang(lang?: string): Lang {
  const l = (lang ?? "").toLowerCase();
  if (l === "json" || l === "jsonc") return "json";
  if (["js", "jsx", "ts", "tsx", "javascript", "typescript"].includes(l)) return "js";
  if (["sh", "bash", "shell", "console", "zsh"].includes(l)) return "sh";
  return "text";
}

// prettier-ignore
const JS_KEYWORDS = new Set(
  ("const let var function return import from export default async await new class extends " +
   "implements interface type enum namespace if else for while do switch case break continue " +
   "throw try catch finally typeof instanceof void delete yield as satisfies readonly public " +
   "private protected static get set this super in of").split(" "),
);

const COLOR: Record<string, string> = {
  keyword: "var(--hl-keyword)",
  string: "var(--hl-string)",
  number: "var(--hl-number)",
  literal: "var(--hl-literal)",
  comment: "var(--hl-comment)",
  key: "var(--hl-key)",
  punct: "var(--hl-punct)",
};

interface Tok {
  text: string;
  type?: keyof typeof COLOR;
}

function lex(code: string, lang: Lang): Tok[] {
  const out: Tok[] = [];
  const push = (text: string, type?: Tok["type"]) => {
    if (text) out.push({ text, type });
  };
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i]!;

    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(code[j]!)) j++;
      push(code.slice(i, j));
      i = j;
      continue;
    }

    // comments
    if (lang === "js" && c === "/" && code[i + 1] === "/") {
      let j = i + 2;
      while (j < n && code[j] !== "\n") j++;
      push(code.slice(i, j), "comment");
      i = j;
      continue;
    }
    if (lang === "js" && c === "/" && code[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(code[j] === "*" && code[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      push(code.slice(i, j), "comment");
      i = j;
      continue;
    }
    if (lang === "sh" && c === "#") {
      let j = i + 1;
      while (j < n && code[j] !== "\n") j++;
      push(code.slice(i, j), "comment");
      i = j;
      continue;
    }

    // strings
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === q) {
          j++;
          break;
        }
        j++;
      }
      const text = code.slice(i, j);
      // JSON: a "..." immediately before a colon is a property key.
      if (lang === "json" && q === '"') {
        let k = j;
        while (k < n && /\s/.test(code[k]!)) k++;
        push(text, code[k] === ":" ? "key" : "string");
      } else {
        push(text, "string");
      }
      i = j;
      continue;
    }

    // numbers
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(code[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9.eExXa-fA-F+_-]/.test(code[j]!)) j++;
      push(code.slice(i, j), "number");
      i = j;
      continue;
    }

    // identifiers / keywords / literals
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j]!)) j++;
      const word = code.slice(i, j);
      const lit = word === "true" || word === "false" || word === "null" || word === "undefined";
      if (lit) push(word, "literal");
      else if (lang === "js" && JS_KEYWORDS.has(word)) push(word, "keyword");
      else push(word);
      i = j;
      continue;
    }

    push(c, "punct");
    i++;
  }
  return out;
}

/** Highlight `code` for `lang` → React nodes. Unknown langs return plain text. */
export function highlight(code: string, lang?: string): React.ReactNode {
  const L = normLang(lang);
  if (L === "text") return code;
  return lex(code, L).map((t, idx) =>
    t.type ? (
      <span key={idx} style={{ color: COLOR[t.type], ...(t.type === "comment" ? { fontStyle: "italic" } : {}) }}>
        {t.text}
      </span>
    ) : (
      <React.Fragment key={idx}>{t.text}</React.Fragment>
    ),
  );
}
