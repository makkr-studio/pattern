/**
 * @pattern-js/mod-identity — the admin screens' dedicated routes.
 *
 * One purposeful route per screen and action (Users / Sessions / Invite /
 * Settings, plus whoami) — no generic op invoker. Each is a normal workflow
 * (request → extract → identity.* op → status → response) built by the shared
 * `httpEndpoint`, admin-scope-gated at the boundary (the ops also re-check
 * `admin` in-op). `whoami` is the one exception: it reports the caller's own
 * principal, so it needs authentication, not the admin scope. Paths are
 * single-sourced here so the workflows and the manifest can't drift.
 */

import { fromBody, fromParams, fromRequestUrl, httpEndpoint, type Workflow } from "@pattern-js/core";

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
  userSetRoles: "/identity/users/:userId/roles",
  invites: "/identity/invites",
  inviteRevoke: "/identity/invites/:inviteId/revoke",
  sessions: "/identity/sessions",
  session: "/identity/sessions/:sessionId",
  apiTokens: "/identity/api-tokens",
  apiTokenRevoke: "/identity/api-tokens/:tokenId/revoke",
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
    r("identity.route.admin.invites.list", "GET", PATHS.invites, "identity.invites.list", { out: "invites" }),
    // ── actions ──
    // The invite's emailed link must be absolute: the request URL rides along so
    // the op can derive the origin (PATTERN_PUBLIC_URL beats it when configured).
    r("identity.route.admin.users.invite", "POST", PATHS.invites, "identity.users.invite", { in: { email: fromBody(), roles: fromBody(), next: fromBody(), url: fromRequestUrl() }, out: "result" }),
    r("identity.route.admin.invites.revoke", "POST", PATHS.inviteRevoke, "identity.invites.revoke", { in: { inviteId: fromParams() }, out: "result" }),
    r("identity.route.admin.users.loginLink", "POST", PATHS.userLoginLink, "identity.users.loginLink", { in: { userId: fromParams() }, out: "result" }),
    r("identity.route.admin.users.toggleDisabled", "POST", PATHS.userToggleDisabled, "identity.users.toggleDisabled", { in: { userId: fromParams() }, out: "user" }),
    r("identity.route.admin.users.revokeSessions", "POST", PATHS.userRevokeSessions, "identity.users.revokeSessions", { in: { userId: fromParams() }, out: "result" }),
    r("identity.route.admin.users.setRoles", "POST", PATHS.userSetRoles, "identity.users.setRoles", { in: { userId: fromParams(), roles: fromBody() }, out: "user" }),
    r("identity.route.admin.users.delete", "DELETE", PATHS.user, "identity.users.delete", { in: { userId: fromParams() }, out: "result" }),
    r("identity.route.admin.sessions.revoke", "DELETE", PATHS.session, "identity.sessions.revoke", { in: { sessionId: fromParams() }, out: "result" }),
    r("identity.route.admin.settings.set", "POST", PATHS.settings, "identity.settings.set", { in: { signup: fromBody() }, out: "result" }),
    // ── API tokens ──
    r("identity.route.admin.apiTokens.list", "GET", PATHS.apiTokens, "identity.apiTokens.list", { out: "tokens" }),
    r("identity.route.admin.apiTokens.create", "POST", PATHS.apiTokens, "identity.apiTokens.create", { in: { name: fromBody(), scopes: fromBody(), ttlDays: fromBody() }, out: "result" }),
    r("identity.route.admin.apiTokens.revoke", "POST", PATHS.apiTokenRevoke, "identity.apiTokens.revoke", { in: { tokenId: fromParams() }, out: "result" }),
  ];
}
