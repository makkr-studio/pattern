import { createAdminClient, type AdminClient } from "@pattern/admin-sdk";

/**
 * The single API client for the SPA. The app is served under `/admin` (the
 * `boundary.http.app` mount, matching Vite's `base`), so the client's base URL
 * is `/admin` and every request hits `/admin/api/*`. All data access goes
 * through `@pattern/admin-sdk` — no hand-rolled fetch in pages.
 */
export const MOUNT = "/admin";

export const api: AdminClient = createAdminClient({ baseUrl: MOUNT });
