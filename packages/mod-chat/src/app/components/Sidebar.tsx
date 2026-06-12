/** Conversation list — quiet until hovered, like a margin note. */

import React from "react";
import { chatStore } from "../lib/store";
import { isMuted, toggleMute } from "../lib/sfx";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Conversation, Me } from "../lib/types";

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Who's chatting — a calm footer chip: the user when signed in, else Guest. */
function IdentityChip({ me }: { me: Me | null }) {
  const user = me?.user ?? null;
  const label = user ? (user.name || user.email || user.id) : "Guest";
  const sub = user ? (user.email && user.name ? user.email : "signed in") : "anonymous on this device";
  return (
    <div className="flex items-center gap-2.5 border-t px-4 py-3" style={{ borderColor: "var(--line-soft)" }}>
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
        style={
          user
            ? { background: "var(--accent-soft)", color: "var(--accent)" }
            : { background: "var(--line-soft)", color: "var(--fg-faint)" }
        }
        aria-hidden
      >
        {user ? label.slice(0, 1).toUpperCase() : "?"}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px]" style={{ color: "var(--fg)" }}>
          {label}
        </div>
        <div className="truncate text-[11px]" style={{ color: "var(--fg-faint)" }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  conversations,
  currentId,
  me,
  onOpen,
  onNew,
}: {
  conversations: Conversation[];
  currentId: string | null;
  me: Me | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [muted, setMuted] = React.useState(isMuted());
  const [pendingDelete, setPendingDelete] = React.useState<Conversation | null>(null);
  return (
    <aside
      className="flex h-full w-[270px] shrink-0 flex-col border-r"
      style={{ borderColor: "var(--line-soft)", background: "var(--bg)" }}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <a href="/chat/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="2.4" fill="var(--accent)" />
            <circle cx="18" cy="9" r="2.4" fill="var(--fg-faint)" />
            <circle cx="9" cy="18" r="2.4" fill="var(--fg-faint)" />
            <path d="M8 7.2 15.8 8.6M7.2 8.2 8.6 15.8M16.3 11l-5.6 5.4" stroke="var(--fg-faint)" strokeWidth="1.3" />
          </svg>
          Pattern Chat
        </a>
        <button
          onClick={() => setMuted(toggleMute())}
          className="text-[12px] transition-opacity hover:opacity-70"
          style={{ color: "var(--fg-faint)" }}
          title={muted ? "Unmute sounds" : "Mute sounds"}
        >
          {muted ? "🔇" : "🔈"}
        </button>
      </div>

      <button
        onClick={onNew}
        className="mx-3 mb-2 rounded-xl border border-dashed px-3 py-2 text-left text-[13.5px] transition-colors hover:border-solid"
        style={{ borderColor: "var(--line)", color: "var(--fg-soft)" }}
      >
        + New conversation
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {conversations.map((c) => (
          <div key={c.id} className="group relative">
            <button
              onClick={() => onOpen(c.id)}
              className="w-full rounded-lg px-2.5 py-2 text-left transition-colors"
              style={{
                background: currentId === c.id ? "var(--line-soft)" : undefined,
              }}
            >
              <div className="truncate pr-7 text-[13.5px]" style={{ color: "var(--fg)" }}>
                {c.title || "Untitled"}
              </div>
              <div className="text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
                {timeAgo(c.updatedAt)}
              </div>
            </button>
            <button
              onClick={() => setPendingDelete(c)}
              className="absolute right-2 top-2.5 hidden h-5 w-5 items-center justify-center rounded text-[12px] group-hover:flex"
              style={{ color: "var(--fg-faint)" }}
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="px-3 py-6 text-[12.5px]" style={{ color: "var(--fg-faint)" }}>
            Nothing yet. Say something →
          </div>
        )}
      </nav>

      <IdentityChip me={me} />

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this conversation?"
          detail={`“${pendingDelete.title || "Untitled"}” and its turns are removed for good.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void chatStore.deleteConversation(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}
