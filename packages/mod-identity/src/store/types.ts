/**
 * @pattern-js/mod-identity — store contracts.
 *
 * Three small stores behind interfaces so the persistence layer is swappable
 * (sqlite ships built-in, in-memory for tests, Postgres later as a driver).
 * Every mutation that can race is **compare-and-swap**: rows carry a `version`,
 * writers pass the version they read, and a `null` return means "lost the
 * race — re-read and retry". On SQL backends CAS is a single conditional
 * UPDATE, which is what makes single-use tokens and session rotation hold
 * across multiple instances; the in-process mutex on top only trims redundant
 * retries on a single node.
 *
 * Secrets never hit storage: sessions and tokens store the sha256 of the
 * opaque secret, so a leaked database can't impersonate anyone.
 */

export type TokenPurpose = "login" | "invite" | "bootstrap";

export interface UserRow {
  id: string;
  email: string;
  /** lower(trim(email)) — the uniqueness key. */
  emailNorm: string;
  name: string | null;
  roles: string[];
  disabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface IdentityLink {
  provider: string;
  /** Provider-scoped subject (for magic-link this is the emailNorm). */
  subject: string;
  userId: string;
  createdAt: number;
}

export interface SessionRow {
  /** Stable session id (NOT the secret) — safe in principals, rooms, logs. */
  id: string;
  /** sha256 hex of the opaque cookie token. */
  tokenHash: string;
  userId: string;
  createdAt: number;
  /** Sliding-expiry bookkeeping; touches are throttled by the service. */
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  version: number;
  userAgent: string | null;
  ip: string | null;
}

export interface TokenRow {
  id: string;
  /** sha256 hex of the single-use secret. */
  tokenHash: string;
  purpose: TokenPurpose;
  /** Target email (login/invite); null for an open bootstrap token. */
  emailNorm: string | null;
  /** Extra payload: roles to grant on invite, a `next` url, … */
  data: Record<string, unknown> | null;
  createdAt: number;
  expiresAt: number;
  /** Set exactly once via CAS — null means unconsumed. */
  consumedAt: number | null;
  version: number;
}

/**
 * An **invite** as a first-class record — what the admin sent, to whom, and
 * what became of it. The single-use `TokenRow` remains the credential (its
 * `data.inviteId` points back here); this row is the audit/status side:
 * listable, revocable, and stamped on acceptance. Status is DERIVED, in
 * precedence order: revoked → accepted → expired → pending.
 */
export interface InviteRow {
  id: string;
  email: string;
  emailNorm: string;
  /** Roles granted on acceptance. */
  roles: string[];
  /** Post-first-login destination (relative path), carried through the flow. */
  next: string | null;
  /** The admin who sent it (user id) — audit only, never authorization. */
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  /** The user the acceptance created (or linked). */
  acceptedUserId: string | null;
  revokedAt: number | null;
  version: number;
}

/** Thrown when an insert hits the one-user-per-email constraint. */
export class UniqueViolationError extends Error {
  constructor(field: string) {
    super(`unique constraint violated: ${field}`);
    this.name = "UniqueViolationError";
  }
}

export interface UserStore {
  countUsers(): Promise<number>;
  findById(id: string): Promise<UserRow | null>;
  findByEmailNorm(emailNorm: string): Promise<UserRow | null>;
  findByIdentity(provider: string, subject: string): Promise<UserRow | null>;
  /** Insert user + identity link atomically. Throws UniqueViolationError on a taken email. */
  createUser(input: {
    email: string;
    emailNorm: string;
    name?: string | null;
    roles: string[];
    identity: { provider: string; subject: string };
  }): Promise<UserRow>;
  /** Link an existing user to a provider identity (idempotent). */
  linkIdentity(userId: string, provider: string, subject: string): Promise<void>;
  /** CAS update. Returns the new row, or null on version mismatch (re-read & retry). */
  updateUser(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<UserRow, "name" | "roles" | "disabled">>,
  ): Promise<UserRow | null>;
  listUsers(opts?: { limit?: number; offset?: number }): Promise<UserRow[]>;
  /**
   * Hard-delete a user with their identity links and sessions (FK order:
   * sessions → identities → user, one transaction). Returns false when absent.
   * The caller (service) revokes sessions FIRST so live sockets close.
   */
  deleteUser(id: string): Promise<boolean>;
}

export interface SessionStore {
  create(row: Omit<SessionRow, "version">): Promise<SessionRow>;
  findByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  findById(id: string): Promise<SessionRow | null>;
  /** Sliding touch (CAS). Null on version mismatch — safe to ignore, the read was fresh. */
  touch(id: string, expectedVersion: number, lastSeenAt: number, expiresAt: number): Promise<SessionRow | null>;
  /** Swap the secret on privilege change (CAS): new hash, same session id. */
  rotate(id: string, expectedVersion: number, newTokenHash: string): Promise<SessionRow | null>;
  revoke(id: string, at: number): Promise<void>;
  /** Revoke every active session of a user; returns the revoked ids. */
  revokeAllForUser(userId: string, at: number): Promise<string[]>;
  listForUser(userId: string): Promise<SessionRow[]>;
  /** All sessions, newest first (admin screen). */
  listAll(opts?: { limit?: number }): Promise<SessionRow[]>;
}

export interface TokenStore {
  create(row: Omit<TokenRow, "version">): Promise<TokenRow>;
  findByTokenHash(tokenHash: string): Promise<TokenRow | null>;
  /**
   * Single-use consume (CAS): sets consumed_at only when it is still null AND
   * the version matches. Exactly one of N concurrent consumers gets the row;
   * the rest get null.
   */
  consume(id: string, expectedVersion: number, at: number): Promise<TokenRow | null>;
  deleteExpired(now: number): Promise<number>;
}

/**
 * A scoped, revocable **API token** (`pat_…` bearer credentials for the
 * control-plane API / MCP server). Unlike `TokenRow` these are MULTI-use:
 * they stay valid until revoked or expired. Same hashing discipline —
 * storage only ever sees the sha256.
 */
export interface ApiTokenRow {
  id: string;
  /** sha256 hex of the full raw bearer secret (including the `pat_` prefix). */
  tokenHash: string;
  /** Operator-chosen label ("CI deploys", "Claude Code"). */
  name: string;
  scopes: string[];
  /** The admin who minted it — audit only, never authorization. */
  userId: string | null;
  createdAt: number;
  /** null = never expires (revocation is the kill switch). */
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  version: number;
}

export interface ApiTokenStore {
  create(row: Omit<ApiTokenRow, "version">): Promise<ApiTokenRow>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRow | null>;
  findById(id: string): Promise<ApiTokenRow | null>;
  /** All tokens, newest first (admin screen). */
  list(): Promise<ApiTokenRow[]>;
  /** CAS revoke: null on version mismatch (re-read & retry). Idempotent on an already-revoked row. */
  revoke(id: string, expectedVersion: number, at: number): Promise<ApiTokenRow | null>;
  /** Best-effort usage stamp — NOT CAS; concurrent stamps race harmlessly toward "recent". */
  touchLastUsed(id: string, at: number): Promise<void>;
}

export interface InviteStore {
  create(row: Omit<InviteRow, "version">): Promise<InviteRow>;
  findById(id: string): Promise<InviteRow | null>;
  /** All invites, newest first (admin screen). */
  list(): Promise<InviteRow[]>;
  /** CAS acceptance stamp — only a live (un-accepted, un-revoked) invite takes it. */
  markAccepted(id: string, expectedVersion: number, at: number, userId: string): Promise<InviteRow | null>;
  /** CAS revoke: null on version mismatch. Idempotent on an already-revoked row. */
  revoke(id: string, expectedVersion: number, at: number): Promise<InviteRow | null>;
}

/** Small persisted key/value bag for runtime-mutable identity settings (signup policy…). */
export interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface IdentityStores {
  users: UserStore;
  sessions: SessionStore;
  tokens: TokenStore;
  apiTokens: ApiTokenStore;
  invites: InviteStore;
  settings: SettingsStore;
  close(): Promise<void>;
}
