/**
 * @pattern/mod-chat — the admin "Chats" surface.
 *
 * Guests were invisible: conversations lived as raw docs in the Data browser,
 * `deviceId` strings and all. This page makes every conversation — user-owned
 * or anonymous — a first-class row: who (username via the identity service
 * when present, else `guest · a1b2c3`), how many turns, when, and a click
 * through to the turn log with run deep-links (the admin-as-agent-debugger
 * story). Sources are `chat.admin.*` ops, admin-scope-guarded in-op.
 */

import { value, z, type FrontendContribution, type OpContext, type OpDefinition } from "@pattern/core";
import type { DocumentRow } from "@pattern/mod-store";
import { CONVERSATIONS, TURNS, stores, type ConversationDoc, type TurnDoc } from "./data.js";

const recordSchema = z.record(z.string(), z.unknown());

function requireScope(ctx: OpContext, scope: string): void {
  const p = ctx.principal;
  if (p.kind !== "user" || !(p.scopes ?? []).includes(scope)) {
    throw new Error(`chat: "${scope}" scope required`);
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

type JsonHandler = (args: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>;

function adminOp(type: string, description: string, handler: JsonHandler): OpDefinition {
  return {
    type,
    title: type,
    description,
    inputs: { params: value(recordSchema), query: value(recordSchema), body: value(z.unknown()) },
    outputs: { out: value() },
    execute: async (ctx) => {
      requireScope(ctx, "admin");
      const [params, query, body] = await Promise.all([
        maybe<Record<string, unknown>>(ctx, "params"),
        maybe<Record<string, unknown>>(ctx, "query"),
        maybe(ctx, "body"),
      ]);
      return { out: await handler({ ...obj(query), ...obj(params), ...obj(body) }, ctx) };
    },
  };
}

/** Duck-typed identity lookup (mod-chat must not depend on mod-identity). */
interface IdentityLike {
  getUser(id: string): Promise<{ email?: string; name?: string | null } | null>;
}

/** "benoit@…" when identity knows the owner, `guest · a1b2c3` when anonymous. */
async function ownerLabel(ctx: OpContext, doc: ConversationDoc): Promise<string> {
  if (doc.ownerId) {
    const identity = ctx.services["identityService"] as IdentityLike | undefined;
    const user = await identity?.getUser(doc.ownerId).catch(() => null);
    return user?.name || user?.email || doc.ownerId;
  }
  return doc.deviceId ? `guest · ${doc.deviceId.slice(0, 6)}` : "guest";
}

const conversationsList = adminOp(
  "chat.admin.conversations",
  "All chat conversations — user-owned and guest — newest first (admin).",
  async (args, ctx) => {
    const svc = stores(ctx);
    const rows = await svc.docs.query({
      collection: CONVERSATIONS,
      orderBy: "updatedAt",
      orderDir: "desc",
      limit: Math.min(Number(args.limit ?? 100), 500),
      offset: Number(args.offset ?? 0),
    });
    return Promise.all(
      rows.map(async (row) => {
        const d = row.data as unknown as ConversationDoc;
        return {
          id: row.id,
          title: d.title || "Untitled",
          owner: await ownerLabel(ctx, d),
          kind: d.ownerId ? "user" : "guest",
          turns: await svc.docs.count(TURNS, { conversationId: row.id }),
          updated: new Date(d.updatedAt).toISOString(),
        };
      }),
    );
  },
);

const conversationGet = adminOp(
  "chat.admin.conversation",
  "One conversation's metadata (admin).",
  async (args, ctx) => {
    const svc = stores(ctx);
    const row = await svc.docs.get(CONVERSATIONS, String(args.id ?? ""));
    if (!row) return { error: "conversation not found" };
    const d = row.data as unknown as ConversationDoc;
    return {
      id: row.id,
      title: d.title || "Untitled",
      owner: await ownerLabel(ctx, d),
      ownerId: d.ownerId ?? "",
      deviceId: d.deviceId ?? "",
      history: Array.isArray(d.history) ? `${d.history.length} items` : "0 items",
      created: new Date(d.createdAt).toISOString(),
      updated: new Date(d.updatedAt).toISOString(),
    };
  },
);

/** Fold a turn's event log into list-row facts (first user text, last error). */
function turnRow(row: DocumentRow): Record<string, unknown> {
  const d = row.data as unknown as TurnDoc;
  const firstText = (d.input ?? []).find(
    (p): p is { type: string; text: string } => obj(p).type === "text" && typeof obj(p).text === "string",
  );
  const lastError = [...(d.events ?? [])].reverse().find((e) => e.type === "error") as
    | { message?: string }
    | undefined;
  return {
    id: row.id,
    input: (firstText?.text ?? "(no text)").slice(0, 80),
    status: d.status,
    events: d.events?.length ?? 0,
    error: lastError?.message?.slice(0, 80) ?? "",
    started: new Date(d.createdAt).toISOString(),
    duration: d.endedAt ? `${((d.endedAt - d.createdAt) / 1000).toFixed(1)}s` : "",
    runId: d.runId,
  };
}

const turnsList = adminOp("chat.admin.turns", "A conversation's turns, oldest first (admin).", async (args, ctx) => {
  const svc = stores(ctx);
  const rows = await svc.docs.query({
    collection: TURNS,
    where: { conversationId: String(args.id ?? "") },
    orderBy: "createdAt",
    orderDir: "asc",
    limit: 500,
  });
  return rows.map(turnRow);
});

const turnGet = adminOp("chat.admin.turn", "One turn's full doc — the event log (admin).", async (args, ctx) => {
  const row = await stores(ctx).docs.get(TURNS, String(args.id ?? ""));
  return row ?? { error: "turn not found" };
});

const conversationDelete = adminOp(
  "chat.admin.conversation.delete",
  "Delete a conversation and its turns (admin).",
  async (args, ctx) => {
    const svc = stores(ctx);
    const id = String(args.id ?? "");
    const turns = await svc.docs.query({ collection: TURNS, where: { conversationId: id }, limit: 10_000 });
    for (const t of turns) await svc.docs.delete(TURNS, t.id);
    return { ok: await svc.docs.delete(CONVERSATIONS, id), turnsDeleted: turns.length };
  },
);

export const chatAdminOps: OpDefinition[] = [
  conversationsList,
  conversationGet,
  turnsList,
  turnGet,
  conversationDelete,
];

export function chatFrontend(): FrontendContribution {
  return {
    menu: [{ category: "Chat", label: "Conversations", icon: "messages-square", path: "/x/chat/conversations", order: 10 }],
    pages: [
      {
        path: "/x/chat/conversations",
        view: {
          kind: "table",
          source: "chat.admin.conversations",
          columns: [
            { key: "title", label: "Conversation" },
            { key: "owner", label: "Owner" },
            { key: "kind", label: "", format: "badge" },
            { key: "turns", label: "Turns" },
            { key: "updated", label: "Last activity", format: "date" },
          ],
          rowActions: [
            { label: "Open", path: "/x/chat/conversations/:id", args: { id: "id" }, icon: "eye" },
            { label: "Delete", run: "chat.admin.conversation.delete", args: { id: "id" }, icon: "trash-2", confirm: true },
          ],
        },
      },
      {
        path: "/x/chat/conversations/:id",
        views: [
          { view: { kind: "detail", source: "chat.admin.conversation" } },
          {
            title: "Turns",
            view: {
              kind: "table",
              source: "chat.admin.turns",
              columns: [
                { key: "input", label: "User said" },
                { key: "status", label: "Status", format: "badge" },
                { key: "events", label: "Events" },
                { key: "error", label: "Error" },
                { key: "duration", label: "Took" },
                { key: "started", label: "Started", format: "date" },
              ],
              rowActions: [
                { label: "Event log", path: "/x/chat/turns/:id", args: { id: "id" }, icon: "list" },
                { label: "Run", path: "/runs/:runId", args: { runId: "runId" }, icon: "activity" },
              ],
            },
          },
        ],
      },
      {
        path: "/x/chat/turns/:id",
        view: { kind: "json", source: "chat.admin.turn" },
      },
    ],
  };
}
