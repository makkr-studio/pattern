/** Pattern Chat — API client (pure fetch; SSE via ReadableStream). */

import type { Conversation, MessagePart, Turn, TurnEvent } from "./types";

const API = "/chat/api";

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
  conversations: {
    list: async (): Promise<Conversation[]> =>
      (await json<{ conversations: Conversation[] }>(await fetch(`${API}/conversations`))).conversations,
    create: async (title?: string): Promise<Conversation> =>
      json(
        await fetch(`${API}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(title ? { title } : {}),
        }),
      ),
    get: async (id: string): Promise<Conversation> => json(await fetch(`${API}/conversations/${id}`)),
    delete: async (id: string): Promise<void> => {
      await json(await fetch(`${API}/conversations/${id}`, { method: "DELETE" }));
    },
  },

  turns: {
    list: async (conversationId: string): Promise<Turn[]> =>
      (await json<{ turns: Turn[] }>(await fetch(`${API}/conversations/${conversationId}/turns`))).turns,
    stop: async (conversationId: string, turnId: string): Promise<void> => {
      await fetch(`${API}/conversations/${conversationId}/turns/${turnId}/stop`, { method: "POST" });
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
 * POST a turn and stream its events. The server keeps the connection open
 * for the turn's lifetime; a refresh mid-turn recovers from the persisted
 * log (api.turns.list) — the SSE is only the live tail.
 */
export async function* streamTurn(
  conversationId: string,
  content: MessagePart[],
  turnId: string,
): AsyncGenerator<TurnEvent> {
  const res = await fetch(`${API}/conversations/${conversationId}/turns`, {
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
  const res = await fetch(`${API}/conversations/${conversationId}/turns/${turnId}/approve`, {
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
