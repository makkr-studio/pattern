/**
 * Pattern Chat — app store (hand-rolled, useSyncExternalStore).
 *
 * One source of truth for conversations + the open conversation's turns.
 * Live turns mutate in place as SSE events arrive; a refresh mid-turn
 * replays the persisted log and (if still running) keeps listening via WS
 * notifications + refetch. Surfaces (transcript today, voice later) consume
 * this store — they never touch the wire directly.
 */

import { api, streamApproval, streamTurn } from "./api";
import { sfx } from "./sfx";
import type { Conversation, Me, MessagePart, Turn, TurnEvent } from "./types";

export interface ChatState {
  /** Identity + auth policy from /chat/api/me (null until loaded). */
  me: Me | null;
  meLoaded: boolean;
  conversations: Conversation[];
  conversationsLoaded: boolean;
  currentId: string | null;
  turns: Turn[];
  turnsLoading: boolean;
  /** The live (streaming) turn id, when this tab owns an open SSE. */
  liveTurnId: string | null;
  /** A 409 we should surface: someone else's turn is running. */
  busy: { turnId: string | null } | null;
  sendError: string | null;
}

type Listener = () => void;

class ChatStore {
  private state: ChatState = {
    me: null,
    meLoaded: false,
    conversations: [],
    conversationsLoaded: false,
    currentId: null,
    turns: [],
    turnsLoading: false,
    liveTurnId: null,
    busy: null,
    sendError: null,
  };
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): ChatState => this.state;

  private set(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Immutable-ish turn update so React re-renders. */
  private patchTurn(turnId: string, mutate: (t: Turn) => Turn) {
    this.set({ turns: this.state.turns.map((t) => (t.id === turnId ? mutate({ ...t }) : t)) });
  }

  /** Identity + auth policy. A failure (older server) just means "no chip". */
  async loadMe(): Promise<void> {
    const me = await api.me().catch(() => null);
    this.set({ me, meLoaded: true });
  }

  /** A 401 mid-session (expired login) — re-ask /me so the sign-in gate shows. */
  private onApiError(err: unknown): void {
    if ((err as { status?: number }).status === 401) void this.loadMe();
  }

  async loadConversations(): Promise<void> {
    try {
      const conversations = await api.conversations.list();
      this.set({ conversations, conversationsLoaded: true });
    } catch (err) {
      this.onApiError(err);
      this.set({ conversations: [], conversationsLoaded: true });
    }
  }

  async open(id: string | null): Promise<void> {
    this.set({ currentId: id, turns: [], busy: null, sendError: null, turnsLoading: id != null });
    if (!id) return;
    const turns = await api.turns.list(id).catch(() => []);
    if (this.state.currentId !== id) return; // user moved on
    this.set({ turns, turnsLoading: false });
  }

  /** Re-pull the open conversation's turns (WS notify, window refocus). */
  async refreshTurns(): Promise<void> {
    const id = this.state.currentId;
    if (!id || this.state.liveTurnId) return; // the live tail is authoritative
    const turns = await api.turns.list(id).catch(() => null);
    if (turns && this.state.currentId === id && !this.state.liveTurnId) this.set({ turns });
  }

  async newConversation(): Promise<string> {
    const conv = await api.conversations.create();
    this.set({ conversations: [conv, ...this.state.conversations] });
    return conv.id;
  }

  async deleteConversation(id: string): Promise<void> {
    await api.conversations.delete(id);
    this.set({ conversations: this.state.conversations.filter((c) => c.id !== id) });
    if (this.state.currentId === id) await this.open(null);
  }

  /** Send a message on the current conversation (creates one when fresh). */
  async send(content: MessagePart[]): Promise<string | null> {
    let conversationId = this.state.currentId;
    if (!conversationId) {
      try {
        conversationId = await this.newConversation();
      } catch (err) {
        this.onApiError(err);
        this.set({ sendError: err instanceof Error ? err.message : String(err) });
        return null;
      }
      this.set({ currentId: conversationId });
    }
    const turnId = crypto.randomUUID();
    const turn: Turn = {
      id: turnId,
      conversationId,
      runId: "",
      input: content,
      events: [],
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
    };
    this.set({ turns: [...this.state.turns, turn], liveTurnId: turnId, busy: null, sendError: null });
    sfx.send();

    try {
      await this.consume(streamTurn(conversationId, content, turnId), turnId);
    } catch (err) {
      const e = err as { status?: number; body?: { activeTurnId?: string } };
      if (e.status === 409) {
        this.set({
          turns: this.state.turns.filter((t) => t.id !== turnId),
          liveTurnId: null,
          busy: { turnId: e.body?.activeTurnId ?? null },
        });
        return conversationId;
      }
      this.onApiError(err);
      this.patchTurn(turnId, (t) => ({ ...t, status: "error" }));
      this.set({ liveTurnId: null, sendError: err instanceof Error ? err.message : String(err) });
      return conversationId;
    }
    return conversationId;
  }

  async approve(turnId: string, interruptionId: string, approved: boolean): Promise<void> {
    const conversationId = this.state.currentId;
    if (!conversationId) return;
    this.patchTurn(turnId, (t) => ({ ...t, status: "running" }));
    this.set({ liveTurnId: turnId });
    try {
      await this.consume(streamApproval(conversationId, turnId, interruptionId, approved), turnId);
    } catch {
      this.set({ liveTurnId: null });
      await this.refreshTurnsForce();
    }
  }

  private async refreshTurnsForce(): Promise<void> {
    const id = this.state.currentId;
    if (!id) return;
    const turns = await api.turns.list(id).catch(() => null);
    if (turns && this.state.currentId === id) this.set({ turns });
  }

  private async consume(genr: AsyncGenerator<TurnEvent>, turnId: string): Promise<void> {
    let sawDone = false;
    try {
      for await (const ev of genr) {
        if (ev.type === "done") sawDone = true;
        this.patchTurn(turnId, (t) => {
          const next = { ...t, events: [...t.events, ev] };
          if (ev.type === "done") {
            next.status =
              ev.stopReason === "complete"
                ? "complete"
                : ev.stopReason === "interrupted"
                  ? "interrupted"
                  : ev.stopReason === "cancelled"
                    ? "cancelled"
                    : "error";
            next.endedAt = Date.now();
          }
          return next;
        });
      }
    } finally {
      const finished = this.state.turns.find((t) => t.id === turnId);
      if (finished?.status === "complete") sfx.done();
      if (finished?.status === "interrupted") sfx.attention();
      this.set({ liveTurnId: this.state.liveTurnId === turnId ? null : this.state.liveTurnId });
      // The live tail ended without a terminal event (producer died, server
      // bounced) — the STORE is the source of truth; re-pull the real state.
      if (!sawDone) void this.refreshTurnsForce();
      void this.loadConversations(); // titles/order may have changed
    }
  }

  async stop(): Promise<void> {
    const { currentId, liveTurnId, busy } = this.state;
    if (!currentId) return;
    const target = liveTurnId ?? busy?.turnId;
    if (!target) return;
    await api.turns.stop(currentId, target).catch(() => {});
    if (busy) this.set({ busy: null });
  }
}

export const chatStore = new ChatStore();
