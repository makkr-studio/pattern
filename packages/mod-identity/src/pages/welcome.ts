/**
 * @pattern-js/mod-identity — the post-login landing of last resort.
 *
 * Logins redirect to `next` → the app's advertised home (AUTH_HOME_URL — the
 * admin registers its mount) → here. Exists so a headless app's first login
 * never dead-ends on a 404: you see who you are and where to go next.
 */

import { escapeHtml, layout } from "./html.js";

export function renderWelcomePage(opts: { email: string; name?: string | null; mount: string }): string {
  const who = opts.name ? `${opts.name} (${opts.email})` : opts.email;
  return layout(
    "Signed in",
    `<h1>You're in ✦</h1>
<p>Signed in as <strong>${escapeHtml(who)}</strong>.</p>
<p>This instance has no frontend registered, so there's nowhere to redirect you —
your session cookie is set and every protected route now answers to you.</p>
<form method="post" action="${escapeHtml(opts.mount)}/logout"><button type="submit">Sign out</button></form>
<p class="hint">Apps advertise a post-login home via the <code>AUTH_HOME_URL</code> service
(the admin mod does this automatically).</p>`,
  );
}
