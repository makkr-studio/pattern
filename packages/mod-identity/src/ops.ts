/**
 * @pattern/mod-identity — the `identity.*` op catalog.
 *
 * Two authoring shapes:
 *  - **json ops** (single `out`) — whoami + the admin-screen surface
 *    (users/sessions). Privileged ones ALSO check `ctx.principal` scopes
 *    in-op: their endpoint workflows are admin-stamped, but defense in depth
 *    means a workflow author can't accidentally expose them anonymously.
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
import { clearSessionCookie, serializeSessionCookie } from "./cookies.js";
import { deliverToken } from "./deliver.js";
import { looksLikeEmail } from "./tokens.js";
import { renderLoginPage, renderSentPage } from "./pages/login.js";
import { renderBootstrapPage } from "./pages/bootstrap.js";
import { renderWelcomePage } from "./pages/welcome.js";
import { safeNextPath } from "./pages/html.js";

const recordSchema = z.record(z.string(), z.unknown());
const stringRecord = z.record(z.string(), z.string());

/* ── helpers ───────────────────────────────────────────────────────────── */

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Merge query/params/body (objects or urlencoded form strings) into args. */
function mergeArgs(query: unknown, params: unknown, body: unknown): Record<string, unknown> {
  let bodyObj: Record<string, unknown>;
  if (typeof body === "string") {
    // Browser form posts arrive urlencoded; the host hands us the raw string.
    bodyObj = Object.fromEntries(new URLSearchParams(body).entries());
  } else {
    bodyObj = obj(body);
  }
  return { ...obj(query), ...obj(params), ...bodyObj };
}

type JsonHandler = (
  args: Record<string, unknown>,
  svc: IdentityService,
  ctx: OpContext,
) => unknown | Promise<unknown>;

/**
 * A JSON op: params/query/body in, a single `out` value out. Deliberately
 * reusable — admin screens reach these through `admin.invoke`, and workflows
 * may wire them (an automation listing users, say). The `scope` guard is the
 * protection: the RUN's principal must carry it, whatever the entry path.
 */
function jsonOp(type: string, description: string, handler: JsonHandler, opts: { scope?: string } = {}): OpDefinition {
  return {
    type,
    title: type,
    description,
    inputs: { params: value(recordSchema), query: value(recordSchema), body: value(z.unknown()) },
    outputs: { out: value() },
    execute: async (ctx) => {
      if (opts.scope) requireScope(ctx, opts.scope);
      const [params, query, body] = await Promise.all([
        ctx.input.value("params"),
        ctx.input.value("query"),
        ctx.input.value("body"),
      ]);
      return { out: await handler(mergeArgs(query, params, body), identityService(ctx), ctx) };
    },
  };
}

interface HttpResult {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

interface HttpRequestCtx {
  /** Request headers (lower-cased keys), wired from the trigger. */
  headers: Record<string, string>;
  principal: OpContext["principal"];
  /**
   * Where a login lands without an explicit `next`: the app's advertised
   * AUTH_HOME_URL (the admin registers its mount), else the welcome page —
   * never a bare "/" that may not exist.
   */
  home: string;
  op: OpContext;
}

type HttpHandler = (
  args: Record<string, unknown>,
  svc: IdentityService,
  req: HttpRequestCtx,
) => HttpResult | Promise<HttpResult>;

/** An HTTP op: also receives request headers; emits status/headers/body ports. */
function httpOp(type: string, description: string, handler: HttpHandler): OpDefinition {
  return {
    type,
    title: type,
    description,
    reusable: false,
    inputs: {
      params: value(recordSchema),
      query: value(recordSchema),
      body: value(z.unknown()),
      headers: value(stringRecord),
    },
    outputs: { status: value(z.number()), headers: value(stringRecord), body: value() },
    execute: async (ctx) => {
      const [params, query, body, headers] = await Promise.all([
        ctx.input.value("params"),
        ctx.input.value("query"),
        ctx.input.value("body"),
        ctx.input.value("headers"),
      ]);
      const svc = identityService(ctx);
      const advertisedHome = ctx.services[AUTH_HOME_URL];
      const req: HttpRequestCtx = {
        headers: (headers ?? {}) as Record<string, string>,
        principal: ctx.principal,
        home: typeof advertisedHome === "string" ? advertisedHome : `${svc.options.mount}/welcome`,
        op: ctx,
      };
      const result = await handler(mergeArgs(query, params, body), svc, req);
      return { status: result.status, headers: result.headers ?? {}, body: result.body ?? null };
    },
  };
}

/** Defense in depth: privileged ops re-check the run principal's scopes. */
function requireScope(ctx: OpContext, scope: string): void {
  const p = ctx.principal;
  if (p.kind !== "user" || !(p.scopes ?? []).includes(scope)) {
    throw new Error(`identity: "${scope}" scope required`);
  }
}

const html = (status: number, body: string, extra: Record<string, string> = {}): HttpResult => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8", ...extra },
  body,
});

const redirect = (location: string, extra: Record<string, string> = {}): HttpResult => ({
  status: 302,
  headers: { location, ...extra },
  body: null,
});

const publicUser = (u: { id: string; email: string; name: string | null; roles: string[]; disabled: boolean; createdAt: number }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: u.roles.join(", "),
  disabled: u.disabled,
  created: new Date(u.createdAt).toISOString(),
});

/* ── whoami ────────────────────────────────────────────────────────────── */

const whoami = jsonOp("identity.whoami", "The current principal: kind, id, email, roles, scopes.", (_args, _svc, ctx) => {
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

/* ── admin-surface ops (scope-guarded) ─────────────────────────────────── */

const usersList = jsonOp(
  "identity.users.list",
  "List users (admin). Roles flattened for table rendering.",
  async (_args, svc) => (await svc.listUsers()).map(publicUser),
  { scope: "admin" },
);

const usersInvite = jsonOp(
  "identity.users.invite",
  'Invite a user by email (admin): mints an invite token and delivers it via the "identity.deliverToken" hook (console fallback). Args { email, roles? (array or comma string) }.',
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
    return { ok: true, email, roles, delivered, ...(delivered ? {} : { url }) };
  },
  { scope: "admin" },
);

const usersSetRoles = jsonOp(
  "identity.users.setRoles",
  "Set a user's roles (admin). Ends the user's sessions — privilege changes re-login. Args { userId, roles }.",
  async (args, svc) => {
    const roles = Array.isArray(args.roles)
      ? (args.roles as string[])
      : String(args.roles ?? "")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean);
    return publicUser(await svc.setRoles(String(args.userId), roles));
  },
  { scope: "admin" },
);

const usersToggleDisabled = jsonOp(
  "identity.users.toggleDisabled",
  "Disable / re-enable a user (admin). Disabling revokes all sessions. Args { userId }.",
  async (args, svc) => {
    const user = await svc.getUser(String(args.userId));
    if (!user) throw new Error("user not found");
    return publicUser(await svc.setDisabled(user.id, !user.disabled));
  },
  { scope: "admin" },
);

const usersRevokeSessions = jsonOp(
  "identity.users.revokeSessions",
  "Revoke every session of a user (admin) — logs them out everywhere, closes their sockets. Args { userId }.",
  async (args, svc) => {
    await svc.revokeAllForUser(String(args.userId));
    return { ok: true };
  },
  { scope: "admin" },
);

const sessionsList = jsonOp(
  "identity.sessions.list",
  "List sessions, newest first (admin). Args { userId? }.",
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
  { scope: "admin" },
);

const sessionsRevoke = jsonOp(
  "identity.sessions.revoke",
  "Revoke one session (admin): it stops resolving and its WS sockets close. Args { sessionId }.",
  async (args, svc) => {
    await svc.revokeSession(String(args.sessionId));
    return { ok: true };
  },
  { scope: "admin" },
);

/* ── auth pages & flows ────────────────────────────────────────────────── */

const loginPage = httpOp(
  "identity.login.page",
  "Render the login page from the registered login methods. Query { next?, error?, sent? }.",
  (args, svc) => {
    if (args.sent) return html(200, renderSentPage(String(args.sent)));
    return html(
      200,
      renderLoginPage({
        methods: svc.loginMethods(),
        next: args.next,
        error: args.error ? String(args.error) : undefined,
      }),
    );
  },
);

const tokenCallback = httpOp(
  "identity.token.callback",
  "The login/invite callback: consumes a single-use token, finds-or-creates the user per the signup policy, mints a session and redirects with the cookie set.",
  async (args, svc, req) => {
    const loginUrl = `${svc.options.mount}/login`;
    const raw = String(args.t ?? "");
    if (!raw) return redirect(`${loginUrl}?error=invalid-token`);

    const token = await svc.consumeToken(raw);
    if (!token || token.purpose === "bootstrap" || !token.emailNorm) {
      // Bootstrap tokens have their own flow; never silently upgrade them here.
      return redirect(`${loginUrl}?error=invalid-token`);
    }

    const data = token.data ?? {};
    const invite = token.purpose === "invite";
    const user = await svc.findOrCreateByIdentity({
      provider: typeof data.provider === "string" ? data.provider : "magic-link",
      subject: token.emailNorm,
      email: token.emailNorm,
      allowCreate: invite || svc.options.signup === "open",
      roles: invite && Array.isArray(data.roles) ? (data.roles as string[]) : undefined,
    });
    if (!user) return redirect(`${loginUrl}?error=signup-closed`);
    if (user.disabled) return redirect(`${loginUrl}?error=account-disabled`);

    const minted = await svc.mintSession(user.id, { userAgent: req.headers["user-agent"] ?? null });
    const next = safeNextPath(args.next ?? data.next ?? req.home);
    return redirect(next, {
      "set-cookie": serializeSessionCookie(svc.options.cookieName, minted.token, {
        secure: svc.options.cookieSecure,
        maxAgeSeconds: svc.options.sessionTtlMs / 1000,
      }),
    });
  },
);

const logout = httpOp(
  "identity.logout",
  "Revoke the current session and clear the cookie. POST (same-origin; the CSRF guard makes forged logouts inert).",
  async (_args, svc, req) => {
    const sessionId = req.principal.kind === "user" ? req.principal.claims?.sessionId : undefined;
    if (typeof sessionId === "string") await svc.revokeSession(sessionId);
    return redirect(`${svc.options.mount}/login`, {
      "set-cookie": clearSessionCookie(svc.options.cookieName, { secure: svc.options.cookieSecure }),
    });
  },
);

const welcomePage = httpOp(
  "identity.welcome.page",
  "Post-login landing of last resort (no AUTH_HOME_URL advertised): who you are + sign-out.",
  (_args, svc, req) => {
    if (req.principal.kind !== "user") return redirect(`${svc.options.mount}/login`);
    const claims = req.principal.claims ?? {};
    return html(
      200,
      renderWelcomePage({
        email: typeof claims.email === "string" ? claims.email : req.principal.id,
        name: typeof claims.name === "string" ? claims.name : null,
        mount: svc.options.mount,
      }),
    );
  },
);

const bootstrapPage = httpOp(
  "identity.bootstrap.page",
  "The first-admin setup form, reached via the one-time URL printed on first boot. Query { t }.",
  (args, svc) => {
    const t = String(args.t ?? "");
    if (!t) return redirect(`${svc.options.mount}/login?error=invalid-token`);
    return html(200, renderBootstrapPage({ token: t, mount: svc.options.mount }));
  },
);

const bootstrapSubmit = httpOp(
  "identity.bootstrap.submit",
  "Consume the bootstrap token, create the first user (bootstrap roles) and sign them in.",
  async (args, svc, req) => {
    const t = String(args.t ?? "");
    const email = String(args.email ?? "").trim();
    if (!looksLikeEmail(email)) {
      return html(400, renderBootstrapPage({ token: t, mount: svc.options.mount, error: "invalid-email" }));
    }
    const token = await svc.consumeToken(t, "bootstrap");
    if (!token) return redirect(`${svc.options.mount}/login?error=invalid-token`);

    const roles = Array.isArray(token.data?.roles) ? (token.data.roles as string[]) : ["admin"];
    const user = await svc.findOrCreateByIdentity({
      provider: "bootstrap",
      subject: email.toLowerCase(),
      email,
      name: args.name ? String(args.name) : undefined,
      allowCreate: true,
      roles,
    });
    if (!user) return redirect(`${svc.options.mount}/login?error=invalid-token`);

    const minted = await svc.mintSession(user.id, { userAgent: req.headers["user-agent"] ?? null });
    return redirect(safeNextPath(token.data?.next ?? req.home), {
      "set-cookie": serializeSessionCookie(svc.options.cookieName, minted.token, {
        secure: svc.options.cookieSecure,
        maxAgeSeconds: svc.options.sessionTtlMs / 1000,
      }),
    });
  },
);

export const identityOps: OpDefinition[] = [
  whoami,
  usersList,
  usersInvite,
  usersSetRoles,
  usersToggleDisabled,
  usersRevokeSessions,
  sessionsList,
  sessionsRevoke,
  loginPage,
  tokenCallback,
  logout,
  welcomePage,
  bootstrapPage,
  bootstrapSubmit,
];
