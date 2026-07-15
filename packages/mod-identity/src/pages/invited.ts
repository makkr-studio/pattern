/**
 * @pattern-js/mod-identity — the invite-accepted interstitial.
 *
 * Clicking an invite link CREATES the account but doesn't sign anyone in:
 * acceptance and the first sign-in are two different acts, and gluing them
 * together made the flow feel like being shoved through a door. This page is
 * the landing between the two — it says what just happened and hands over to
 * the login screen, carrying the invite's `next` path so the first login
 * lands where the inviting admin intended.
 */

import { escapeHtml, layout, safeNextPath } from "./html.js";

export function renderInvitedPage(opts: { mount: string; next: string }): string {
  const next = safeNextPath(opts.next);
  const login = `${opts.mount}/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  return layout(
    "Invitation accepted",
    `<h1>Your account is ready ✦</h1>
<p>Your invitation has been accepted and your account now exists.</p>
<p>One last step: sign in for the first time. Pick any sign-in method on the next screen — it will use this same email address.</p>
<a class="btn" href="${escapeHtml(login)}">Continue to sign-in</a>
<p class="hint">Invite links are single use — from now on, you sign in like everyone else.</p>`,
  );
}
