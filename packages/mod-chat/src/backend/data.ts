/**
 * @pattern-js/mod-chat — data model (mod-store collections).
 *
 * - `chat.conversations` — one doc per conversation: owner scoping
 *   (user id, or an anonymous device cookie), title, and the provider-shaped
 *   `history` the agent reads/writes.
 * - `chat.turns` — one doc per turn: the persisted TURN EVENT LOG. The store
 *   is the source of truth, SSE is a live tail: refresh mid-turn replays from
 *   here; every turn reaches a terminal status, always.
 */

import type { OpContext } from "@pattern-js/core";
import type { TurnEvent } from "@pattern-js/mod-agents";
import { STORE_SERVICE } from "@pattern-js/mod-store";
import type { DocumentRow, PatternStores } from "@pattern-js/mod-store";

export const CONVERSATIONS = "chat.conversations";
export const TURNS = "chat.turns";

export interface ConversationDoc {
  title: string;
  ownerId: string | null;
  deviceId: string | null;
  /** Logical instance partition (decoupled from the mount). Legacy/absent reads
   *  as "default", so one shared backend can serve many branded SPAs whose
   *  conversation lists stay separate. */
  namespace?: string;
  history: unknown[];
  createdAt: number;
  updatedAt: number;
}

/** A conversation's namespace, defaulting to "default" for legacy/unset docs. */
export const DEFAULT_NS = "default";
export function nsOf(doc: { namespace?: string }): string {
  return doc.namespace ?? DEFAULT_NS;
}

export type TurnStatus = "running" | "complete" | "error" | "interrupted" | "cancelled";

export interface TurnDoc {
  conversationId: string;
  /** The engine runId executing (or having executed) this turn — Stop cancels it. */
  runId: string;
  /** What the user sent (typed parts). */
  input: unknown[];
  /** The persisted event log (deltas coalesced into text chunks). */
  events: TurnEvent[];
  status: TurnStatus;
  /** Opaque resume token when status === "interrupted" (HITL). */
  stateToken: string | null;
  createdAt: number;
  endedAt: number | null;
}

export function stores(ctx: OpContext): PatternStores {
  const svc = ctx.services[STORE_SERVICE] as PatternStores | undefined;
  if (!svc) {
    throw new Error('mod-chat needs @pattern-js/mod-store — add "@pattern-js/mod-store" to your mods');
  }
  return svc;
}

export async function ensureChatCollections(svc: PatternStores): Promise<void> {
  await svc.docs.ensureCollection({ name: CONVERSATIONS, indexes: ["ownerId", "deviceId"] });
  await svc.docs.ensureCollection({ name: TURNS, indexes: ["conversationId", "status", "runId"] });
}

/** Who owns the request: a user id (identity) or the device cookie. */
export interface Scope {
  ownerId: string | null;
  deviceId: string | null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const DEVICE_COOKIE = "chat_device";

/**
 * The caller's scope from the resolved `user` (identity) and the device id —
 * the latter read from the request `cookies` port in the workflow, so the op
 * never touches headers/cookies. Logged-in users scope by `ownerId`; anonymous
 * visitors by their `chat_device` cookie.
 */
export function scopeFrom(user: { id?: string } | null | undefined, deviceId: string | null | undefined): Scope {
  if (user && typeof user.id === "string") return { ownerId: user.id, deviceId: null };
  return { ownerId: null, deviceId: deviceId ?? null };
}

export function mayAccess(doc: ConversationDoc, scope: Scope): boolean {
  if (doc.ownerId != null) return doc.ownerId === scope.ownerId;
  // Anonymous conversations are device-scoped.
  return doc.deviceId != null && doc.deviceId === scope.deviceId;
}

export function conversationView(row: DocumentRow): Record<string, unknown> {
  const d = row.data as unknown as ConversationDoc;
  return {
    id: row.id,
    title: d.title,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    historyLength: Array.isArray(d.history) ? d.history.length : 0,
  };
}

export function turnView(row: DocumentRow): Record<string, unknown> {
  const d = row.data as unknown as TurnDoc;
  return {
    id: row.id,
    conversationId: d.conversationId,
    runId: d.runId,
    input: d.input,
    events: d.events,
    status: d.status,
    createdAt: d.createdAt,
    endedAt: d.endedAt,
  };
}
