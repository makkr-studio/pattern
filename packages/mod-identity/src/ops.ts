/**
 * @pattern/mod-identity — the `identity.*` op catalog.
 *
 * Two authoring shapes:
 *  - **json ops** (single `out`) — whoami + the admin-screen surface
 *    (users/sessions). The privileged ones are PURE: they never check scopes
 *    in-op. Authorization is the trigger's job — their admin routes stamp
 *    `requireAuth: { scopes: ["admin"] }` — and a `sensitivity: "privileged"`
 *    tag lets the validator warn if a route ever forgets the gate.
 *  - **http ops** ({ status, headers, body }) — the auth pages and redirects
 *    (login page, token callback, logout, bootstrap), where Set-Cookie and
 *    Location ARE the result.
 *
 * The security kernel stays in code on purpose: token consumption and session
 * minting are not editable in the admin; the *delivery* of tokens is the
 * customizable part (the `identity.deliverToken` hook).
 */

import { AUTH_HOME_URL, value, z, type OpContext, type OpDefinition } from "@pattern/core";
import { identityService } from "./service-key.js";
import type { IdentityService } from "./service.js";
import { deliverToken } from "./deliver.js";
import { looksLikeEmail } from "./tokens.js";
import { renderLoginPage, renderSentPage } from "./pages/login.js";
import { renderBootstrapPage } from "./pages/bootstrap.js";
import { renderWelcomePage } from "./pages/welcome.js";
import { safeNextPath } from "./pages/html.js";

/* ── helpers ───────────────────────────────────────────────────────────── */

type JsonHandler = (
  args: Record<string, unknown>,
  svc: IdentityService,
  ctx: OpContext,
) => unknown | Promise<unknown>;

/**
 * A JSON op: discrete named inputs in, a single `out` value out — a PURE domain
 * function. Each is fronted by its own dedicated admin route (see
 * `./admin-routes.ts`) that decomposes the request onto these ports and carries
 * the auth; workflows may also wire them (an automation listing users, or a CLI
 * trigger with no session at all — which is exactly why the op stays scope-free).
 */
function jsonOp(
  type: string,
  description: string,
  io: { in?: Record<string, z.ZodType>; out: string },
  handler: JsonHandler,
  opts: { sensitivity?: "privileged" } = {},
): OpDefinition {
  const inSpec = io.in ?? {};
  return {
    type,
    title: type,
    inputs: Object.fromEntries(Object.entries(inSpec).map(([k, s]) => [k, value(s)])),
    outputs: { [io.out]: value() },
    description,
    // Pure: no scope check in-op. Authorization is the trigger's job (the admin
    // routes stamp `requireAuth: { scopes: ["admin"] }`); `privileged` only flags
    // the data so the validator catches a route that forgets the gate.
    ...(opts.sensitivity ? { sensitivity: opts.sensitivity } : {}),
    execute: async (ctx) => {
      const args: Record<string, unknown> = {};
      await Promise.all(Object.keys(inSpec).map(async (k) => void (args[k] = ctx.input.has(k) ? await ctx.input.value(k) : undefined)));
      return { [io.out]: await handler(args, identityService(ctx), ctx) };
    },
  };
}

/** An auth-page/redirect op's result — the workflow renders it on the out-gate. */
interface AuthResponse {
  body?: string;
  redirect?: string;
  cookies?: Record<string, unknown>;
  status?: number;
}

interface AuthCtx {
  principal: OpContext["principal"];
  /**
   * Where a login lands without an explicit `next`: the app's advertised
   * AUTH_HOME_URL (the admin registers its mount), else the welcome page.
   */
  home: string;
  ctx: OpContext;
}

type AuthHandler = (args: Record<string, unknown>, svc: IdentityService, req: AuthCtx) => AuthResponse | Promise<AuthResponse>;

/** Per-op route I/O for the auth pages — which request fields each reads. */
export const authOpRoutes: Record<string, { query: string[]; body: string[]; userAgent: boolean }> = {};

/**
 * An auth-page / redirect op as a PURE function: discrete inputs (the query/body
 * fields it reads + the user-agent for session minting — all decomposed by the
 * workflow), and discrete outputs { body, redirect, cookies, status } the route
 * wires onto boundary.http.response. The op reads the resolved principal +
 * advertised home from ctx — never HTTP shape.
 */
function authOp(
  type: string,
  description: string,
  io: { query?: string[]; body?: string[]; userAgent?: boolean },
  handler: AuthHandler,
): OpDefinition {
  const query = io.query ?? [];
  const body = io.body ?? [];
  authOpRoutes[type] = { query, body, userAgent: Boolean(io.userAgent) };
  const inputs: Record<string, ReturnType<typeof value>> = {};
  for (const k of [...query, ...body]) inputs[k] = value(z.string().optional());
  if (io.userAgent) inputs.userAgent = value(z.string().optional());
  return {
    type,
    title: type,
    description,
    reusable: false,
    inputs,
    outputs: {
      body: value(),
      redirect: value(z.string()),
      cookies: value(z.record(z.string(), z.unknown())),
      status: value(z.number()),
    },
    execute: async (ctx) => {
      const args: Record<string, unknown> = {};
      for (const k of [...query, ...body, ...(io.userAgent ? ["userAgent"] : [])]) {
        args[k] = ctx.input.has(k) ? await ctx.input.value(k) : undefined;
      }
      const svc = identityService(ctx);
      const advertisedHome = ctx.services[AUTH_HOME_URL];
      const req: AuthCtx = {
        principal: ctx.principal,
        home: typeof advertisedHome === "string" ? advertisedHome : `${svc.options.mount}/welcome`,
        ctx,
      };
      const r = await handler(args, svc, req);
      return { body: r.body ?? null, redirect: r.redirect ?? null, cookies: r.cookies ?? null, status: r.status ?? null };
    },
  };
}

/** The session cookie as a structured value the out-gate serializes (HttpOnly + SameSite=Lax by default). */
const sessionCookie = (svc: IdentityService, token: string): Record<string, unknown> => ({
  [svc.options.cookieName]: { value: token, maxAge: Math.floor(svc.options.sessionTtlMs / 1000), secure: svc.options.cookieSecure },
});
const clearCookie = (svc: IdentityService): Record<string, unknown> => ({
  [svc.options.cookieName]: { value: "", maxAge: 0, secure: svc.options.cookieSecure },
});

const page = (body: string, status?: number): AuthResponse => (status !== undefined ? { body, status } : { body });
const redirectTo = (location: string, cookies?: Record<string, unknown>): AuthResponse =>
  cookies ? { redirect: location, cookies } : { redirect: location };

const publicUser = (u: { id: string; email: string; name: string | null; roles: string[]; disabled: boolean; createdAt: number }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: u.roles.join(", "),
  disabled: u.disabled,
  created: new Date(u.createdAt).toISOString(),
});

/* ── whoami ────────────────────────────────────────────────────────────── */

const whoami = jsonOp("identity.whoami", "The current principal: kind, id, email, roles, scopes.", { out: "whoami" }, (_args, _svc, ctx) => {
  const p = ctx.principal;
  if (p.kind !== "user") return { kind: "anonymous" };
  return {
    kind: "user",
    id: p.id,
    email: p.claims?.email,
    name: p.claims?.name,
    roles: p.claims?.roles ?? [],
    scopes: p.scopes ?? [],
    sessionId: p.claims?.sessionId,
  };
});

/* ── admin-surface ops (pure; gated by their routes, tagged `privileged`) ── */

const usersList = jsonOp(
  "identity.users.list",
  "List users (admin). Roles flattened for table rendering.",
  { out: "users" },
  async (_args, svc) => (await svc.listUsers()).map(publicUser),
  { sensitivity: "privileged" },
);

const usersInvite = jsonOp(
  "identity.users.invite",
  'Invite a user by email (admin): mints an invite token and delivers it via the "identity.deliverToken" hook (console fallback). Args { email, roles? (array or comma string) }.',
  { in: { email: z.string(), roles: z.unknown().optional() }, out: "result" },
  async (args, svc, ctx) => {
    const email = String(args.email ?? "").trim();
    if (!looksLikeEmail(email)) throw new Error("invalid email");
    const roles =
      Array.isArray(args.roles)
        ? (args.roles as string[])
        : String(args.roles ?? "")
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
    const issued = await svc.issueToken({
      purpose: "invite",
      email,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // invites get a week, not 15 minutes
      data: { roles },
    });
    const { delivered, url } = await deliverToken(ctx, { email, path: issued.path, purpose: "invite" });
    // Undelivered (no email channel): hand the link to the inviting admin —
    // `copy` renders as a copyable field in the admin's result view.
    return { ok: true, email, roles, delivered, ...(delivered ? {} : { copy: url }) };
  },
  { sensitivity: "privileged" },
);

const usersSetRoles = jsonOp(
  "identity.users.setRoles",
  "Set a user's roles (admin). Ends the user's sessions — privilege changes re-login. Args { userId, roles }.",
  { in: { userId: z.string(), roles: z.unknown().optional() }, out: "user" },
  async (args, svc) => {
    const roles = Array.isArray(args.roles)
      ? (args.roles as string[])
      : String(args.roles ?? "")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean);
    return publicUser(await svc.setRoles(String(args.userId), roles));
  },
  { sensitivity: "privileged" },
);

const usersToggleDisabled = jsonOp(
  "identity.users.toggleDisabled",
  "Disable / re-enable a user (admin). Disabling revokes all sessions. Args { userId }.",
  { in: { userId: z.string() }, out: "user" },
  async (args, svc) => {
    const user = await svc.getUser(String(args.userId));
    if (!user) throw new Error("user not found");
    return publicUser(await svc.setDisabled(user.id, !user.disabled));
  },
  { sensitivity: "privileged" },
);

const usersRevokeSessions = jsonOp(
  "identity.users.revokeSessions",
  "Revoke every session of a user (admin) — logs them out everywhere, closes their sockets. Args { userId }.",
  { in: { userId: z.string() }, out: "result" },
  async (args, svc) => {
    await svc.revokeAllForUser(String(args.userId));
    return { ok: true };
  },
  { sensitivity: "privileged" },
);

/** Minimal shape of the admin's trace store we read run stats from (feature-detected). */
interface RunsReadable {
  list(filter?: { limit?: number }): Promise<
    Array<{
      workflowId: string;
      status: string;
      startTime: number;
      durationMs?: number;
      principal?: { kind?: string; id?: string };
    }>
  >;
}
const canReadRuns = (s: unknown): s is RunsReadable => typeof (s as RunsReadable | undefined)?.list === "function";

const usersGet = jsonOp(
  "identity.users.get",
  "One user's profile for the details page (admin). Args { userId }.",
  { in: { userId: z.string() }, out: "user" },
  async (args, svc) => {
    const user = await svc.getUser(String(args.userId));
    if (!user) throw new Error("user not found");
    const sessions = await svc.listSessions(user.id);
    const active = sessions.filter((s) => s.revokedAt == null && s.expiresAt > Date.now());
    return {
      email: user.email,
      name: user.name ?? "—",
      roles: user.roles.join(", ") || "—",
      scopes: svc.scopesForRoles(user.roles).join(", ") || "—",
      disabled: user.disabled,
      created: new Date(user.createdAt).toLocaleString(),
      "active sessions": active.length,
      "user id": user.id,
    };
  },
  { sensitivity: "privileged" },
);

const usersRunStats = jsonOp(
  "identity.users.runStats",
  "Per-workflow run counts for a user, from the admin's retained run window (admin). Args { userId }.",
  { in: { userId: z.string() }, out: "stats" },
  async (args, svc, ctx) => {
    const user = await svc.getUser(String(args.userId));
    if (!user) throw new Error("user not found");
    // The trace sink is the ADMIN's service — feature-detected, so this op
    // degrades to an empty list when the admin isn't installed. Stats cover
    // the sink's retained window (bounded ring buffer), not all time.
    const sink = ctx.services["adminTraceSink"];
    if (!canReadRuns(sink)) return [];
    const runs = (await sink.list({ limit: 10_000 }))
      // The admin's declarative-page data fetches (`*.route.admin.*`) and other
      // `__`-prefixed plumbing are not the user's workflows — exclude them so
      // they don't drown the real numbers when an admin views their own page.
      .filter(
        (r) =>
          r.principal?.kind === "user" &&
          r.principal.id === user.id &&
          !r.workflowId.startsWith("__") &&
          !r.workflowId.includes(".route.admin."),
      );
    const byWorkflow = new Map<string, { workflow: string; runs: number; errors: number; lastRun: number; totalMs: number; timed: number }>();
    for (const r of runs) {
      const agg = byWorkflow.get(r.workflowId) ?? { workflow: r.workflowId, runs: 0, errors: 0, lastRun: 0, totalMs: 0, timed: 0 };
      agg.runs++;
      if (r.status === "error") agg.errors++;
      if (r.startTime > agg.lastRun) agg.lastRun = r.startTime;
      if (r.durationMs != null) {
        agg.totalMs += r.durationMs;
        agg.timed++;
      }
      byWorkflow.set(r.workflowId, agg);
    }
    return [...byWorkflow.values()]
      .sort((a, b) => b.runs - a.runs)
      .map((a) => ({
        workflow: a.workflow,
        runs: a.runs,
        errors: a.errors,
        "avg ms": a.timed ? Math.round(a.totalMs / a.timed) : "—",
        "last run": new Date(a.lastRun).toLocaleString(),
      }));
  },
  { sensitivity: "privileged" },
);

const usersLoginLink = jsonOp(
  "identity.users.loginLink",
  "Mint a single-use sign-in link for a user (admin) — for handing over manually when no email/SMS delivery is wired. Args { userId }.",
  { in: { userId: z.string() }, out: "result" },
  async (args, svc) => {
    const user = await svc.getUser(String(args.userId));
    if (!user) throw new Error("user not found");
    if (user.disabled) throw new Error("user is disabled — re-enable them first");
    const issued = await svc.issueToken({ purpose: "login", email: user.email });
    return {
      // `copy` is the result-view convention: rendered as a copyable field
      // (the admin prepends its origin for absolute links).
      copy: issued.path,
      email: user.email,
      "valid until": new Date(issued.expiresAt).toLocaleString(),
      note: "single use — send it over any channel",
    };
  },
  { sensitivity: "privileged" },
);

const settingsGet = jsonOp(
  "identity.settings.get",
  "Current identity settings (admin): the effective signup policy.",
  { out: "settings" },
  async (_args, svc) => ({ signup: await svc.getSignup() }),
  { sensitivity: "privileged" },
);

const settingsSet = jsonOp(
  "identity.settings.set",
  'Update identity settings (admin). Args { signup: "open" | "invite" }. Persisted — survives restarts.',
  { in: { signup: z.string().optional() }, out: "result" },
  async (args, svc) => {
    if (args.signup !== undefined) await svc.setSignup(args.signup as "open" | "invite");
    return { signup: await svc.getSignup() };
  },
  { sensitivity: "privileged" },
);

const sessionsList = jsonOp(
  "identity.sessions.list",
  "List sessions, newest first (admin). Args { userId? }.",
  { in: { userId: z.string().optional() }, out: "sessions" },
  async (args, svc) => {
    const sessions = await svc.listSessions(args.userId ? String(args.userId) : undefined);
    const emails = new Map<string, string>();
    for (const s of sessions) {
      if (!emails.has(s.userId)) emails.set(s.userId, (await svc.getUser(s.userId))?.email ?? s.userId);
    }
    return sessions.map((s) => ({
      id: s.id,
      user: emails.get(s.userId),
      created: new Date(s.createdAt).toISOString(),
      lastSeen: new Date(s.lastSeenAt).toISOString(),
      status: s.revokedAt != null ? "revoked" : s.expiresAt <= Date.now() ? "expired" : "active",
      userAgent: s.userAgent ?? "",
    }));
  },
  { sensitivity: "privileged" },
);

const sessionsRevoke = jsonOp(
  "identity.sessions.revoke",
  "Revoke one session (admin): it stops resolving and its WS sockets close. Args { sessionId }.",
  { in: { sessionId: z.string() }, out: "result" },
  async (args, svc) => {
    await svc.revokeSession(String(args.sessionId));
    return { ok: true };
  },
  { sensitivity: "privileged" },
);

/* ── auth pages & flows ────────────────────────────────────────────────── */

const loginPage = authOp(
  "identity.login.page",
  "Render the login page from the registered login methods. Query { next?, error?, sent? }.",
  { query: ["next", "error", "sent"] },
  (args, svc) => {
    if (args.sent) return page(renderSentPage(String(args.sent)));
    return page(
      renderLoginPage({
        methods: svc.loginMethods(),
        next: args.next,
        error: args.error ? String(args.error) : undefined,
      }),
    );
  },
);

const tokenCallback = authOp(
  "identity.token.callback",
  "The login/invite callback: consumes a single-use token, finds-or-creates the user per the signup policy, mints a session and redirects with the cookie set.",
  { query: ["t", "next"], userAgent: true },
  async (args, svc, req) => {
    const loginUrl = `${svc.options.mount}/login`;
    const raw = String(args.t ?? "");
    if (!raw) return redirectTo(`${loginUrl}?error=invalid-token`);

    const token = await svc.consumeToken(raw);
    if (!token || token.purpose === "bootstrap" || !token.emailNorm) {
      // Bootstrap tokens have their own flow; never silently upgrade them here.
      return redirectTo(`${loginUrl}?error=invalid-token`);
    }

    const data = token.data ?? {};
    const invite = token.purpose === "invite";
    const user = await svc.findOrCreateByIdentity({
      provider: typeof data.provider === "string" ? data.provider : "magic-link",
      subject: token.emailNorm,
      email: token.emailNorm,
      // The EFFECTIVE policy (admin-toggleable), not the construction-time option.
      allowCreate: invite || (await svc.getSignup()) === "open",
      roles: invite && Array.isArray(data.roles) ? (data.roles as string[]) : undefined,
    });
    if (!user) return redirectTo(`${loginUrl}?error=signup-closed`);
    if (user.disabled) return redirectTo(`${loginUrl}?error=account-disabled`);

    const minted = await svc.mintSession(user.id, { userAgent: (args.userAgent as string) ?? null });
    const next = safeNextPath(args.next ?? data.next ?? req.home);
    return redirectTo(next, sessionCookie(svc, minted.token));
  },
);

const logout = authOp(
  "identity.logout",
  "Revoke the current session and clear the cookie. POST (same-origin; the CSRF guard makes forged logouts inert).",
  {},
  async (_args, svc, req) => {
    const sessionId = req.principal.kind === "user" ? req.principal.claims?.sessionId : undefined;
    if (typeof sessionId === "string") await svc.revokeSession(sessionId);
    return redirectTo(`${svc.options.mount}/login`, clearCookie(svc));
  },
);

const welcomePage = authOp(
  "identity.welcome.page",
  "Post-login landing of last resort (no AUTH_HOME_URL advertised): who you are + sign-out.",
  {},
  (_args, svc, req) => {
    if (req.principal.kind !== "user") return redirectTo(`${svc.options.mount}/login`);
    const claims = req.principal.claims ?? {};
    return page(
      renderWelcomePage({
        email: typeof claims.email === "string" ? claims.email : req.principal.id,
        name: typeof claims.name === "string" ? claims.name : null,
        mount: svc.options.mount,
      }),
    );
  },
);

const bootstrapPage = authOp(
  "identity.bootstrap.page",
  "The first-admin setup form, reached via the one-time URL printed on first boot. Query { t }.",
  { query: ["t"] },
  (args, svc) => {
    const t = String(args.t ?? "");
    if (!t) return redirectTo(`${svc.options.mount}/login?error=invalid-token`);
    return page(renderBootstrapPage({ token: t, mount: svc.options.mount }));
  },
);

const bootstrapSubmit = authOp(
  "identity.bootstrap.submit",
  "Consume the bootstrap token, create the first user (bootstrap roles) and sign them in.",
  { body: ["t", "email", "name"], userAgent: true },
  async (args, svc, req) => {
    const t = String(args.t ?? "");
    const email = String(args.email ?? "").trim();
    if (!looksLikeEmail(email)) {
      return page(renderBootstrapPage({ token: t, mount: svc.options.mount, error: "invalid-email" }), 400);
    }
    const token = await svc.consumeToken(t, "bootstrap");
    if (!token) return redirectTo(`${svc.options.mount}/login?error=invalid-token`);

    const roles = Array.isArray(token.data?.roles) ? (token.data.roles as string[]) : ["admin"];
    const user = await svc.findOrCreateByIdentity({
      provider: "bootstrap",
      subject: email.toLowerCase(),
      email,
      name: args.name ? String(args.name) : undefined,
      allowCreate: true,
      roles,
    });
    if (!user) return redirectTo(`${svc.options.mount}/login?error=invalid-token`);

    const minted = await svc.mintSession(user.id, { userAgent: (args.userAgent as string) ?? null });
    return redirectTo(safeNextPath(token.data?.next ?? req.home), sessionCookie(svc, minted.token));
  },
);

export const identityOps: OpDefinition[] = [
  whoami,
  usersList,
  usersInvite,
  usersSetRoles,
  usersToggleDisabled,
  usersRevokeSessions,
  usersGet,
  usersRunStats,
  usersLoginLink,
  settingsGet,
  settingsSet,
  sessionsList,
  sessionsRevoke,
  loginPage,
  tokenCallback,
  logout,
  welcomePage,
  bootstrapPage,
  bootstrapSubmit,
];
