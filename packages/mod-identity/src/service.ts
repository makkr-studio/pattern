/**
 * @pattern/mod-identity — the identity service (§9).
 *
 * Registered on the engine under core's `IDENTITY_SERVICE` key; consumed by
 * this mod's ops, by provider mods (magic-link, oidc…) and by the admin's
 * secure-by-default check. Bridges the two meanings of "auth provider":
 * login methods prove who a human is (interactive flows, registered here);
 * the session AuthProvider turns the resulting cookie back into a principal
 * on every request.
 *
 * Scopes are compiled from roles **at resolve time**, so editing the role
 * map applies on the next request — sessions store no scopes.
 */

import type { ConnectionRegistry } from "@pattern/core";
import type { ResolvedIdentityOptions } from "./options.js";
import type { IdentityStores, SessionRow, TokenPurpose, TokenRow, UserRow } from "./store/types.js";
import { UniqueViolationError } from "./store/types.js";
import { KeyedMutex } from "./store/mutex.js";
import { normalizeEmail, randomToken, sha256hex } from "./tokens.js";

/** A way to log in, registered by provider mods in their `ready` hook. */
export interface LoginMethod {
  id: string;
  label: string;
  /** "form" posts fields to startUrl; "redirect" navigates to startUrl. */
  kind: "form" | "redirect";
  startUrl: string;
  /** Form field hint for the login page (default: a single email field). */
  fields?: Array<{ name: string; label: string; type?: string }>;
}

export interface MintedSession {
  sessionId: string;
  /** The RAW cookie secret — only ever returned here, stored hashed. */
  token: string;
  expiresAt: number;
}

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  /** Compiled from the user's roles via the role map. */
  scopes: string[];
}

export interface IssuedToken {
  /** The RAW single-use secret. */
  token: string;
  /** Path-only callback URL (`{mount}/token?t=…[&next=…]`); callers prepend an origin if needed. */
  path: string;
  expiresAt: number;
}

export interface FindOrCreateInput {
  provider: string;
  subject: string;
  email: string;
  name?: string;
  /** True when arriving via invite/bootstrap token or open signup. */
  allowCreate: boolean;
  /** Roles granted on creation (invite/bootstrap). */
  roles?: string[];
}

export interface IdentityService {
  // users
  findOrCreateByIdentity(input: FindOrCreateInput): Promise<UserRow | null>;
  getUser(id: string): Promise<UserRow | null>;
  /** Lookup by (normalized) email — provider mods gate token issuance on this. */
  findUserByEmail(email: string): Promise<UserRow | null>;
  listUsers(): Promise<UserRow[]>;
  /** CAS-retried. Revokes the user's sessions — privilege changes end sessions. */
  setRoles(userId: string, roles: string[]): Promise<UserRow>;
  /** CAS-retried. Disabling also revokes all sessions. */
  setDisabled(userId: string, disabled: boolean): Promise<UserRow>;

  // sessions
  mintSession(userId: string, meta?: { userAgent?: string | null; ip?: string | null }): Promise<MintedSession>;
  resolveSessionByToken(rawToken: string, now?: number): Promise<ResolvedSession | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  listSessions(userId?: string): Promise<SessionRow[]>;

  // single-use token kernel
  issueToken(input: {
    purpose: TokenPurpose;
    email?: string;
    ttlMs?: number;
    data?: Record<string, unknown>;
  }): Promise<IssuedToken>;
  consumeToken(rawToken: string, purpose?: TokenPurpose): Promise<TokenRow | null>;

  // login-method registry (provider mods register in `ready`)
  registerLoginMethod(method: LoginMethod): void;
  loginMethods(): LoginMethod[];

  // roles → scopes
  scopesForRoles(roles: string[]): string[];

  // runtime settings (persisted; the mod option is only the default seed)
  /** The EFFECTIVE signup policy — admin-toggleable at runtime. */
  getSignup(): Promise<"open" | "invite">;
  setSignup(mode: "open" | "invite"): Promise<void>;

  // config surface other code reads
  readonly options: ResolvedIdentityOptions;
}

/** Duck-typed: the node registry grows closeRoom; others may not have it. */
interface RoomClosable {
  closeRoom(room: string, code?: number, reason?: string): Promise<void>;
}
const canCloseRooms = (c: unknown): c is RoomClosable =>
  typeof (c as RoomClosable | undefined)?.closeRoom === "function";

export class DefaultIdentityService implements IdentityService {
  private readonly methods = new Map<string, LoginMethod>();
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly stores: IdentityStores,
    readonly options: ResolvedIdentityOptions,
    /** The engine's connection registry — revocation closes live WS sockets. */
    private readonly connections?: ConnectionRegistry,
  ) {}

  /* ── users ───────────────────────────────────────────────────────────── */

  async findOrCreateByIdentity(input: FindOrCreateInput): Promise<UserRow | null> {
    const emailNorm = normalizeEmail(input.email);

    const byIdentity = await this.stores.users.findByIdentity(input.provider, input.subject);
    if (byIdentity) return byIdentity;

    // Same email proven through a new provider → link, don't duplicate.
    const byEmail = await this.stores.users.findByEmailNorm(emailNorm);
    if (byEmail) {
      await this.stores.users.linkIdentity(byEmail.id, input.provider, input.subject);
      return byEmail;
    }

    if (!input.allowCreate) return null;
    try {
      return await this.stores.users.createUser({
        email: input.email.trim(),
        emailNorm,
        name: input.name ?? null,
        roles: input.roles ?? [],
        identity: { provider: input.provider, subject: input.subject },
      });
    } catch (err) {
      if (err instanceof UniqueViolationError) {
        // Lost a concurrent-create race — the winner is our user.
        const winner = await this.stores.users.findByEmailNorm(emailNorm);
        if (winner) {
          await this.stores.users.linkIdentity(winner.id, input.provider, input.subject);
          return winner;
        }
      }
      throw err;
    }
  }

  getUser(id: string): Promise<UserRow | null> {
    return this.stores.users.findById(id);
  }

  findUserByEmail(email: string): Promise<UserRow | null> {
    return this.stores.users.findByEmailNorm(normalizeEmail(email));
  }

  listUsers(): Promise<UserRow[]> {
    return this.stores.users.listUsers();
  }

  async setRoles(userId: string, roles: string[]): Promise<UserRow> {
    const updated = await this.casUpdateUser(userId, { roles });
    // Privilege change: existing sessions carry the old privilege — end them.
    await this.revokeAllForUser(userId);
    return updated;
  }

  async setDisabled(userId: string, disabled: boolean): Promise<UserRow> {
    const updated = await this.casUpdateUser(userId, { disabled });
    if (disabled) await this.revokeAllForUser(userId);
    return updated;
  }

  /** Read-modify-write with CAS retry under the per-user mutex. */
  private casUpdateUser(
    userId: string,
    patch: Partial<Pick<UserRow, "name" | "roles" | "disabled">>,
  ): Promise<UserRow> {
    return this.mutex.run(`user:${userId}`, async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await this.stores.users.findById(userId);
        if (!current) throw new Error(`user "${userId}" not found`);
        const next = await this.stores.users.updateUser(userId, current.version, patch);
        if (next) return next;
      }
      throw new Error(`user "${userId}": CAS update kept losing — concurrent writer storm?`);
    });
  }

  /* ── sessions ────────────────────────────────────────────────────────── */

  async mintSession(
    userId: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<MintedSession> {
    const token = randomToken();
    const now = Date.now();
    const row = await this.stores.sessions.create({
      id: crypto.randomUUID(),
      tokenHash: sha256hex(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.options.sessionTtlMs,
      revokedAt: null,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });
    return { sessionId: row.id, token, expiresAt: row.expiresAt };
  }

  async resolveSessionByToken(rawToken: string, now: number = Date.now()): Promise<ResolvedSession | null> {
    const session = await this.stores.sessions.findByTokenHash(sha256hex(rawToken));
    if (!session || session.revokedAt != null || session.expiresAt <= now) return null;

    const user = await this.stores.users.findById(session.userId);
    if (!user || user.disabled) return null;

    // Sliding expiry, throttled so hot sessions don't write per request. A
    // lost CAS just means another request already touched — the read above
    // was fresh either way.
    if (now - session.lastSeenAt >= this.options.touchThrottleMs) {
      await this.stores.sessions.touch(session.id, session.version, now, now + this.options.sessionTtlMs);
    }

    return { session, user, scopes: this.scopesForRoles(user.roles) };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.stores.sessions.revoke(sessionId, Date.now());
    await this.closeSessionSockets(sessionId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const ids = await this.stores.sessions.revokeAllForUser(userId, Date.now());
    for (const id of ids) await this.closeSessionSockets(id);
  }

  private async closeSessionSockets(sessionId: string): Promise<void> {
    if (canCloseRooms(this.connections)) {
      await this.connections.closeRoom(`session:${sessionId}`, 4001, "session revoked").catch(() => {});
    }
  }

  listSessions(userId?: string): Promise<SessionRow[]> {
    return userId ? this.stores.sessions.listForUser(userId) : this.stores.sessions.listAll();
  }

  /* ── token kernel ────────────────────────────────────────────────────── */

  async issueToken(input: {
    purpose: TokenPurpose;
    email?: string;
    ttlMs?: number;
    data?: Record<string, unknown>;
  }): Promise<IssuedToken> {
    const token = randomToken();
    const now = Date.now();
    const row = await this.stores.tokens.create({
      id: crypto.randomUUID(),
      tokenHash: sha256hex(token),
      purpose: input.purpose,
      emailNorm: input.email ? normalizeEmail(input.email) : null,
      data: input.data ?? null,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? this.options.tokenTtlMs),
      consumedAt: null,
    });
    const next = typeof input.data?.next === "string" ? input.data.next : undefined;
    const path = `${this.options.mount}/token?t=${token}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    // Opportunistic sweep: issuing is rare enough to piggyback cleanup on.
    await this.stores.tokens.deleteExpired(now).catch(() => {});
    return { token, path, expiresAt: row.expiresAt };
  }

  async consumeToken(rawToken: string, purpose?: TokenPurpose): Promise<TokenRow | null> {
    const found = await this.stores.tokens.findByTokenHash(sha256hex(rawToken));
    if (!found) return null;
    if (purpose && found.purpose !== purpose) return null;
    if (found.expiresAt <= Date.now()) return null;
    return this.mutex.run(`token:${found.id}`, () =>
      this.stores.tokens.consume(found.id, found.version, Date.now()),
    );
  }

  /* ── login methods ───────────────────────────────────────────────────── */

  registerLoginMethod(method: LoginMethod): void {
    this.methods.set(method.id, method);
  }

  loginMethods(): LoginMethod[] {
    return [...this.methods.values()];
  }

  /* ── roles → scopes ──────────────────────────────────────────────────── */

  scopesForRoles(roles: string[]): string[] {
    const out = new Set<string>();
    for (const role of roles) for (const scope of this.options.roles[role] ?? []) out.add(scope);
    return [...out];
  }

  /* ── runtime settings ────────────────────────────────────────────────── */

  // Read-through on purpose (no cache): a settings read is one indexed hit,
  // and it keeps multiple instances honest without invalidation machinery.
  async getSignup(): Promise<"open" | "invite"> {
    const stored = await this.stores.settings.get("signup");
    return stored === "open" || stored === "invite" ? stored : this.options.signup;
  }

  async setSignup(mode: "open" | "invite"): Promise<void> {
    if (mode !== "open" && mode !== "invite") throw new Error(`invalid signup mode "${mode}"`);
    await this.stores.settings.set("signup", mode);
  }
}
