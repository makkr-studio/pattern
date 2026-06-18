/**
 * @pattern/mod-identity — the admin screens' dedicated routes.
 *
 * One purposeful route per screen and action (Users / Sessions / Invite /
 * Settings, plus whoami) — no generic op invoker. Each is a normal workflow
 * (request → extract → identity.* op → status → response) built by the shared
 * `httpEndpoint`, admin-scope-gated at the boundary (the ops also re-check
 * `admin` in-op). `whoami` is the one exception: it reports the caller's own
 * principal, so it needs authentication, not the admin scope. Paths are
 * single-sourced here so the workflows and the manifest can't drift.
 */

import { fromBody, fromParams, httpEndpoint, type Workflow } from "@pattern/core";

const API = "/admin/api";

/** Route paths relative to the admin API mount — the manifest's `RouteRef.path`. */
export const PATHS = {
  users: "/identity/users",
  user: "/identity/users/:userId",
  userRunStats: "/identity/users/:userId/run-stats",
  userSessions: "/identity/users/:userId/sessions",
  userLoginLink: "/identity/users/:userId/login-link",
  userToggleDisabled: "/identity/users/:userId/toggle-disabled",
  userRevokeSessions: "/identity/users/:userId/revoke-sessions",
  invites: "/identity/invites",
  sessions: "/identity/sessions",
  session: "/identity/sessions/:sessionId",
  settings: "/identity/settings",
  whoami: "/identity/whoami",
} as const;

/** The route workflows that back the admin Access screens. */
export function identityAdminRoutes(): Workflow[] {
  const admin = { scopes: ["admin"] };
  const r = (
    id: string,
    method: string,
    path: string,
    op: string,
    io: Parameters<typeof httpEndpoint>[0]["io"],
    auth: true | { scopes: string[] } = admin,
  ): Workflow => httpEndpoint({ id, name: `Identity · ${method} ${API}${path}`, method, path: `${API}${path}`, op, io, auth });

  return [
    // ── reads ──
    r("identity.route.admin.users.list", "GET", PATHS.users, "identity.users.list", { out: "users" }),
    r("identity.route.admin.users.get", "GET", PATHS.user, "identity.users.get", { in: { userId: fromParams() }, out: "user" }),
    r("identity.route.admin.users.runStats", "GET", PATHS.userRunStats, "identity.users.runStats", { in: { userId: fromParams() }, out: "stats" }),
    r("identity.route.admin.users.sessions", "GET", PATHS.userSessions, "identity.sessions.list", { in: { userId: fromParams() }, out: "sessions" }),
    r("identity.route.admin.sessions.list", "GET", PATHS.sessions, "identity.sessions.list", { out: "sessions" }),
    r("identity.route.admin.settings.get", "GET", PATHS.settings, "identity.settings.get", { out: "settings" }),
    // whoami is about the *caller* — authentication, not the admin scope.
    r("identity.route.admin.whoami", "GET", PATHS.whoami, "identity.whoami", { out: "whoami" }, true),
    // ── actions ──
    r("identity.route.admin.users.invite", "POST", PATHS.invites, "identity.users.invite", { in: { email: fromBody(), roles: fromBody() }, out: "result" }),
    r("identity.route.admin.users.loginLink", "POST", PATHS.userLoginLink, "identity.users.loginLink", { in: { userId: fromParams() }, out: "result" }),
    r("identity.route.admin.users.toggleDisabled", "POST", PATHS.userToggleDisabled, "identity.users.toggleDisabled", { in: { userId: fromParams() }, out: "user" }),
    r("identity.route.admin.users.revokeSessions", "POST", PATHS.userRevokeSessions, "identity.users.revokeSessions", { in: { userId: fromParams() }, out: "result" }),
    r("identity.route.admin.sessions.revoke", "DELETE", PATHS.session, "identity.sessions.revoke", { in: { sessionId: fromParams() }, out: "result" }),
    r("identity.route.admin.settings.set", "POST", PATHS.settings, "identity.settings.set", { in: { signup: fromBody() }, out: "result" }),
  ];
}
