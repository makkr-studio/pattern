/** Pattern Chat — API client (pure fetch; SSE via ReadableStream). */

import type { Conversation, Me, MessagePart, Turn, TurnEvent } from "./types";
import { appBoot } from "./config";

// Two roots on the SHARED backend: `API` for unscoped calls (/me, blobs) and
// `NS` for conversation/turn calls, which carry this instance's namespace in the
// path so the backend partitions data (and a per-namespace pipeline fork wins).
const API = appBoot.apiBase;
const NS = `${API}/${appBoot.namespace}`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 201) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(`${res.status} ${detail}`), { status: res.status, detail });
  }
  return (await res.json()) as T;
}

export const api = {
  /** Who am I, and is auth required? Always open — drives the sign-in gate. */
  me: async (): Promise<Me> => json(await fetch(`${API}/me`)),

  conversations: {
    list: async (): Promise<Conversation[]> =>
      (await json<{ conversations: Conversation[] }>(await fetch(`${NS}/conversations`))).conversations,
    create: async (title?: string): Promise<Conversation> =>
      json(
        await fetch(`${NS}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(title ? { title } : {}),
        }),
      ),
    get: async (id: string): Promise<Conversation> => json(await fetch(`${NS}/conversations/${id}`)),
    delete: async (id: string): Promise<void> => {
      await json(await fetch(`${NS}/conversations/${id}`, { method: "DELETE" }));
    },
  },

  turns: {
    list: async (conversationId: string): Promise<Turn[]> =>
      (await json<{ turns: Turn[] }>(await fetch(`${NS}/conversations/${conversationId}/turns`))).turns,
    stop: async (conversationId: string, turnId: string): Promise<void> => {
      await fetch(`${NS}/conversations/${conversationId}/turns/${turnId}/stop`, { method: "POST" });
    },
  },

  blobs: {
    upload: async (file: File | Blob): Promise<{ id: string; meta: { mime: string } }> =>
      json(
        await fetch(`${API}/blobs`, {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        }),
      ),
    url: (id: string): string => `/store/blobs/${id}`,
  },
};

export interface TurnRequestError extends Error {
  status?: number;
}

/**
 * Ask the identity stack to email a sign-in link. The endpoint always answers
 * 200 (no account enumeration) — "sent" here means "if that address exists,
 * a link is on its way". `next` brings the user back to the chat after login.
 */
/** Revoke the session. POST (identity's CSRF guard makes forged logouts inert). */
export async function signOut(logoutPath: string): Promise<void> {
  await fetch(logoutPath, { method: "POST" }).catch(() => {});
}

export async function requestMagicLink(requestPath: string, email: string): Promise<void> {
  const res = await fetch(requestPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, next: `${appBoot.mount}/` }),
  });
  if (!res.ok) throw new Error(`sign-in request failed (${res.status})`);
}

/**
 * POST a turn and stream its events. The server keeps the connection open
 * for the turn's lifetime; a refresh mid-turn recovers from the persisted
 * log (api.turns.list) — the SSE is only the live tail.
 */
export async function* streamTurn(
  conversationId: string,
  content: MessagePart[],
  turnId: string,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`${NS}/conversations/${conversationId}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ turnId, content }),
  });
  if (!res.ok || !res.body) {
    let body: unknown = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error("turn request failed"), { status: res.status, body });
  }
  yield* parseSse(res.body);
}

/** Approve/deny an interrupted turn; streams the resumed tail of the SAME turn. */
export async function* streamApproval(
  conversationId: string,
  turnId: string,
  interruptionId: string,
  approved: boolean,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`${NS}/conversations/${conversationId}/turns/${turnId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ interruptionId, approved }),
  });
  if (!res.ok || !res.body) {
    throw Object.assign(new Error("approval failed"), { status: res.status });
  }
  yield* parseSse(res.body);
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              yield JSON.parse(line.slice(6)) as TurnEvent;
            } catch {
              /* tolerate partial frames */
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
