/**
 * @pattern/mod-identity — the login page.
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
    : `<p>No login methods are installed. Add one (e.g. <code>@pattern/mod-auth-magic-link</code>) to your mods.</p>`;

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

/** Post-request page ("check your email / console"). */
export function renderSentPage(email: string): string {
  return layout(
    "Check your inbox",
    `<h1>Check your inbox</h1>
<p>If <strong>${escapeHtml(email)}</strong> has an account (or sign-ups are open), a sign-in link is on its way.</p>
<p class="hint">No email mod installed? The link was printed to the server console.</p>`,
  );
}
