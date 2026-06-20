/**
 * @pattern-js/mod-identity — the bootstrap (first-admin) page.
 *
 * Reached via the one-time URL printed to the console on first boot. One
 * email field; submitting consumes the bootstrap token and creates the
 * first user with the bootstrap roles + a session.
 */

import { escapeHtml, errorBanner, layout } from "./html.js";

export function renderBootstrapPage(opts: { token: string; mount: string; error?: string }): string {
  return layout(
    "Welcome to Pattern",
    `<h1>Create the first account</h1>
<p>This one-time link sets up the owner of this Pattern instance${opts.error ? "" : " — it becomes an admin"}.</p>
${errorBanner(opts.error)}
<form method="post" action="${escapeHtml(opts.mount)}/bootstrap">
<label for="email">Your email</label>
<input id="email" name="email" type="email" required autocomplete="email" autofocus>
<label for="name">Name <span style="color:#5d6676">(optional)</span></label>
<input id="name" name="name" type="text" autocomplete="name">
<input type="hidden" name="t" value="${escapeHtml(opts.token)}">
<button type="submit">Create account &amp; sign in</button>
</form>
<p class="hint">Lost this link? Restart with an empty user store to mint a new one.</p>`,
  );
}
