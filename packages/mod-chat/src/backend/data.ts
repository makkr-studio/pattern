/**
 * @pattern/mod-chat — data model (mod-store collections).
 *
 * - `chat.conversations` — one doc per conversation: owner scoping
 *   (user id, or an anonymous device cookie), title, and the provider-shaped
 *   `history` the agent reads/writes.
 * - `chat.turns` — one doc per turn: the persisted TURN EVENT LOG. The store
 *   is the source of truth, SSE is a live tail: refresh mid-turn replays from
 *   here; every turn reaches a terminal status, always.
 */

import type { OpContext } from "@pattern/core";
import type { TurnEvent } from "@pattern/mod-agents";
import { STORE_SERVICE } from "@pattern/mod-store";
import type { DocumentRow, PatternStores } from "@pattern/mod-store";

export const CONVERSATIONS = "chat.conversations";
export const TURNS = "chat.turns";

export interface ConversationDoc {
  title: string;
  ownerId: string | null;
  deviceId: string | null;
  history: unknown[];
  createdAt: number;
  updatedAt: number;
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
    throw new Error('mod-chat needs @pattern/mod-store — add "@pattern/mod-store" to your mods');
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

export function scopeOf(
  user: { id?: string } | null | undefined,
  headers: Record<string, string> | undefined,
): Scope {
  if (user && typeof user.id === "string") return { ownerId: user.id, deviceId: null };
  const device = parseCookies(headers?.cookie)[DEVICE_COOKIE];
  return { ownerId: null, deviceId: device ?? null };
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
