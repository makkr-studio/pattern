/**
 * Pattern Chat — the shell. The transcript is SURFACE #1 over the chat
 * store's turn-event feed; a voice/avatar surface plugs into the same store
 * in a later round (it consumes events, not the wire).
 */

import React, { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { chatStore } from "./lib/store";
import { connectNotify } from "./lib/ws";
import { Sidebar } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { Composer } from "./components/Composer";
import { SignIn } from "./components/SignIn";
import "./index.css";

function useChat() {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getState);
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="6" cy="6" r="2.4" fill="var(--accent)" />
        <circle cx="18" cy="9" r="2.4" fill="var(--fg-faint)" />
        <circle cx="9" cy="18" r="2.4" fill="var(--fg-faint)" />
        <path d="M8 7.2 15.8 8.6M7.2 8.2 8.6 15.8M16.3 11l-5.6 5.4" stroke="var(--fg-faint)" strokeWidth="1.3" />
      </svg>
      <h1 className="text-[19px] font-semibold tracking-tight">What are we building today?</h1>
      <p className="max-w-sm text-[14px]" style={{ color: "var(--fg-soft)" }}>
        Your message runs through a Pattern workflow — the agent, its tools and guardrails are nodes
        you can rewire in the admin.
      </p>
    </div>
  );
}

function App() {
  const state = useChat();

  useEffect(() => {
    void chatStore.loadMe();
    void chatStore.loadConversations();
    // WS notifications: other tabs/devices, scheduled agents, approvals.
    const off = connectNotify((n) => {
      if (n.type === "chat.turn.updated") {
        void chatStore.loadConversations();
        const payload = n.payload as { conversationId?: string };
        if (payload?.conversationId === chatStore.getState().currentId) void chatStore.refreshTurns();
      }
    });
    const onFocus = () => void chatStore.refreshTurns();
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const streaming = state.liveTurnId != null;

  // The server says auth is required and we're anonymous → the sign-in gate
  // replaces the app (the API would 401 anyway; this is the nice version).
  if (state.me?.authRequired && !state.me.user) {
    return <SignIn me={state.me} />;
  }

  return (
    <div className="flex h-full">
      <Sidebar
        conversations={state.conversations}
        currentId={state.currentId}
        me={state.me}
        onOpen={(id) => void chatStore.open(id)}
        onNew={() => void chatStore.open(null)}
      />
      <main className="flex h-full min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {state.currentId == null && state.turns.length === 0 ? (
            <EmptyState />
          ) : state.turnsLoading ? (
            <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "var(--fg-faint)" }}>
              loading…
            </div>
          ) : (
            <Transcript turns={state.turns} liveTurnId={state.liveTurnId} />
          )}
        </div>
        {state.sendError && (
          <div className="mx-auto w-full max-w-[44rem] px-5 pb-2">
            <div
              className="rounded-lg border px-3.5 py-2 text-[13px]"
              style={{ borderColor: "var(--danger)", background: "var(--danger-soft)", color: "var(--fg)" }}
            >
              {state.sendError}
            </div>
          </div>
        )}
        <Composer streaming={streaming} busy={state.busy != null} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
