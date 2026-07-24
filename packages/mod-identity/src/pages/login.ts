/**
 * @pattern-js/mod-identity — the login page.
 *
 * Rendered from the login-method registry, so it grows a section per
 * provider mod (magic-link form, OIDC buttons, …) with zero page changes.
 * `next` survives the round-trip as a hidden field / query param.
 */

import type { LoginMethod } from "../service.js";
import { escapeHtml, errorBanner, layout, safeNextPath } from "./html.js";

export function renderLoginPage(opts: {
  methods: LoginMethod[];
  next?: unknown;
  error?: string;
  notice?: string;
}): string {
  const next = safeNextPath(opts.next);

  const sections = opts.methods.length
    ? opts.methods.map((m) => renderMethod(m, next)).join("\n")
    : `<p>No login methods are installed. Add one (e.g. <code>@pattern-js/mod-auth-magic-link</code>) to your mods.</p>`;

  const notice = opts.notice ? `<p>${escapeHtml(opts.notice)}</p>` : "";

  return layout(
    "Sign in",
    `<h1>Sign in</h1>
<p>to continue${next !== "/" ? ` to <code>${escapeHtml(next)}</code>` : ""}</p>
${errorBanner(opts.error)}
${notice}
${sections}`,
  );
}

function renderMethod(method: LoginMethod, next: string): string {
  if (method.kind === "redirect") {
    const url = `${method.startUrl}${method.startUrl.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
    return `<div class="method"><a class="btn" href="${escapeHtml(url)}">${escapeHtml(method.label)}</a></div>`;
  }
  const fields = method.fields ?? [{ name: "email", label: "Email", type: "email" }];
  const inputs = fields
    .map(
      (f) => `<label for="${escapeHtml(f.name)}">${escapeHtml(f.label)}</label>
<input id="${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" type="${escapeHtml(f.type ?? "text")}" required autocomplete="${f.type === "email" ? "email" : "on"}">`,
    )
    .join("\n");
  return `<div class="method"><form method="post" action="${escapeHtml(method.startUrl)}">
${inputs}
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit">${escapeHtml(method.label)}</button>
</form></div>`;
}

/**
 * Post-request page ("check your email / console"). With `code`, it also
 * carries the code-entry form — the PWA path: the emailed LINK opens in the
 * system browser's cookie jar, but a code typed HERE sets the session cookie
 * in the browsing context the user is actually in. Rendered identically
 * whether or not a token was issued (no enumeration), so the form always
 * shows; a code for a non-account simply never matches.
 */
export function renderSentPage(
  email: string,
  code?: { action: string; email: string; next?: string; error?: string },
): string {
  const form = code
    ? `<form method="post" action="${escapeHtml(code.action)}">
<label for="code">Or enter the 6-digit code from the email</label>
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" required>
<input type="hidden" name="email" value="${escapeHtml(code.email)}">
<input type="hidden" name="next" value="${escapeHtml(safeNextPath(code.next))}">
<button type="submit">Sign in with the code</button>
</form>`
    : "";
  return layout(
    "Check your inbox",
    `<h1>Check your inbox</h1>
${errorBanner(code?.error)}
<p>If <strong>${escapeHtml(email)}</strong> has an account (or sign-ups are open), a sign-in link is on its way.</p>
${form}
<p class="hint">No email mod installed? The ${code ? "link and code were" : "link was"} printed to the server console.</p>`,
  );
}
