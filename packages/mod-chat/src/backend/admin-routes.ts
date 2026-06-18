/**
 * @pattern/mod-chat — the admin Conversations surface's dedicated routes.
 *
 * One purposeful route per screen and action — no generic op invoker. Each is a
 * normal workflow (request → extract → chat.admin.* op → status → response)
 * built by the shared `httpEndpoint`, admin-scope-gated at the boundary (the
 * ops also re-check `admin` in-op). Paths are single-sourced here so the
 * workflows and the manifest can't drift.
 */

import { fromParams, httpEndpoint, type Workflow } from "@pattern/core";

const API = "/admin/api";

/** Route paths relative to the admin API mount — the manifest's `RouteRef.path`. */
export const PATHS = {
  conversations: "/chat/conversations",
  conversation: "/chat/conversations/:id",
  conversationTurns: "/chat/conversations/:id/turns",
  turn: "/chat/turns/:id",
} as const;

/** The route workflows that back the admin Conversations screens (admin-scope gated). */
export function chatAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  const r = (id: string, method: string, path: string, op: string, io: Parameters<typeof httpEndpoint>[0]["io"]): Workflow =>
    httpEndpoint({ id, name: `Chat · ${method} ${API}${path}`, method, path: `${API}${path}`, op, io, auth });

  return [
    r("chat.route.admin.conversations", "GET", PATHS.conversations, "chat.admin.conversations", { out: "conversations" }),
    r("chat.route.admin.conversation", "GET", PATHS.conversation, "chat.admin.conversation", { in: { id: fromParams() }, out: "conversation" }),
    r("chat.route.admin.turns", "GET", PATHS.conversationTurns, "chat.admin.turns", { in: { id: fromParams() }, out: "turns" }),
    r("chat.route.admin.turn", "GET", PATHS.turn, "chat.admin.turn", { in: { id: fromParams() }, out: "turn" }),
    r("chat.route.admin.conversation.delete", "DELETE", PATHS.conversation, "chat.admin.conversation.delete", { in: { id: fromParams() }, out: "result" }),
  ];
}
