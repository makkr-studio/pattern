/**
 * @pattern/mod-identity — hand-written HTML pages.
 *
 * No build step, no React: auth pages are tiny, must work before anything
 * else does, and follow the admin placeholder's dark-glass aesthetic so the
 * front door matches the house.
 */

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Only relative paths survive as a post-login destination — anything else
 * (absolute URLs, protocol-relative `//`) is an open-redirect vector.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; background: #0b0d12; color: #e6e9ef; }
  .card { width: min(92vw, 420px); padding: 2rem 2.25rem; border-radius: 16px;
          background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
          backdrop-filter: blur(12px); }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  p { color: #9aa3b2; font-size: .9rem; margin: .25rem 0 1rem; }
  label { display: block; font-size: .8rem; color: #9aa3b2; margin: .75rem 0 .25rem; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .75rem; border-radius: 10px;
          border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.3);
          color: #e6e9ef; font: inherit; }
  input:focus { outline: none; border-color: #7cf; box-shadow: 0 0 0 2px rgba(119,204,255,.2); }
  button, .btn { display: block; width: 100%; margin-top: 1rem; padding: .65rem .75rem;
          border-radius: 10px; border: 1px solid rgba(119,204,255,.4); cursor: pointer;
          background: rgba(119,204,255,.12); color: #7cf; font: inherit; font-weight: 600;
          text-align: center; text-decoration: none; box-sizing: border-box; }
  button:hover, .btn:hover { background: rgba(119,204,255,.2); }
  .error { border: 1px solid rgba(255,99,132,.4); background: rgba(255,99,132,.08);
           color: #ff8fa3; padding: .6rem .75rem; border-radius: 10px; font-size: .85rem;
           margin-bottom: 1rem; }
  .hint { font-size: .78rem; color: #5d6676; margin-top: 1.25rem; }
  .brand { font-size: .75rem; letter-spacing: .14em; text-transform: uppercase;
           color: #5d6676; margin-bottom: 1rem; }
  .method + .method { border-top: 1px solid rgba(255,255,255,.08); margin-top: 1.25rem; padding-top: .5rem; }
</style></head>
<body><div class="card"><div class="brand">⌬ Pattern</div>
${body}
</div></body></html>`;
}

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-token": "That link is invalid, expired, or was already used. Request a fresh one.",
  "signup-closed": "Sign-ups are invite-only. Ask an admin to invite you.",
  "account-disabled": "This account is disabled.",
  "invalid-email": "That doesn't look like an email address.",
};

export function errorBanner(code: string | undefined): string {
  if (!code) return "";
  const message = ERROR_MESSAGES[code] ?? "Something went wrong. Try again.";
  return `<div class="error">${escapeHtml(message)}</div>`;
}
