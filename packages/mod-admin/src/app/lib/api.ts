import { createAdminClient, type AdminClient } from "@pattern-js/admin-sdk";

/**
 * The single API client for the SPA. The app is served under `/admin` (the
 * `boundary.http.app` mount, matching Vite's `base`), so the client's base URL
 * is `/admin` and every request hits `/admin/api/*`. All data access goes
 * through `@pattern-js/admin-sdk` — no hand-rolled fetch in pages.
 */
export const MOUNT = "/admin";

/** Where the identity mod serves its login page (its default mount). */
export const LOGIN_URL = "/auth/login";

/**
 * 401 → bounce to the login page with a return path (§9). This is the one
 * chokepoint every API call flows through, so an expired/revoked session
 * anywhere in the app lands on the login screen instead of dead spinners.
 */
const guardedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.assign(`${LOGIN_URL}?next=${next}`);
    // Give the navigation a beat; surface a readable error to any caller racing it.
    throw new Error("session expired — redirecting to login");
  }
  return res;
};

export const api: AdminClient = createAdminClient({ baseUrl: MOUNT, fetch: guardedFetch });
