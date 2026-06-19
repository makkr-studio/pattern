/**
 * Conversation list — quiet until hovered, like a margin note.
 *
 * Responsive: a static rail on md+, a slide-over (scrim + translate) below.
 * The parent owns `open`; navigation closes it so a phone never strands you
 * behind the drawer.
 */

import React from "react";
import { chatStore } from "../lib/store";
import { appBoot, brandTitle } from "../lib/config";
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

/**
 * Who's chatting — a calm footer chip. Signed in: name + sign-out. Guest:
 * the door the other way (sign-in is voluntary when auth isn't required).
 */
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
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: "var(--fg)" }}>
          {label}
        </div>
        <div className="truncate text-[11px]" style={{ color: "var(--fg-faint)" }}>
          {sub}
        </div>
      </div>
      {user ? (
        <button
          onClick={() => void chatStore.signOut()}
          className="shrink-0 rounded-md p-1.5 transition-colors hover:bg-[var(--line-soft)]"
          style={{ color: "var(--fg-faint)" }}
          title="Sign out"
          aria-label="Sign out"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      ) : (
        me && (
          <button
            onClick={() => chatStore.setSignInOpen(true)}
            className="shrink-0 rounded-md border px-2 py-1 text-[11.5px] transition-colors hover:border-[var(--fg-faint)]"
            style={{ borderColor: "var(--line)", color: "var(--fg-soft)" }}
          >
            Sign in
          </button>
        )
      )}
    </div>
  );
}

export function Sidebar({
  conversations,
  currentId,
  me,
  open,
  onClose,
  onOpen,
  onNew,
}: {
  conversations: Conversation[];
  currentId: string | null;
  me: Me | null;
  /** Slide-over visibility below md (ignored on desktop — always shown). */
  open: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [muted, setMuted] = React.useState(isMuted());
  const [pendingDelete, setPendingDelete] = React.useState<Conversation | null>(null);
  return (
    <>
      {/* Scrim — mobile only, while the drawer is out. */}
      {open && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: "rgba(20, 16, 12, 0.35)" }}
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-[270px] shrink-0 flex-col border-r transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ borderColor: "var(--line-soft)", background: "var(--bg)" }}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <a href={`${appBoot.mount}/`} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="2.4" fill="var(--accent)" />
              <circle cx="18" cy="9" r="2.4" fill="var(--fg-faint)" />
              <circle cx="9" cy="18" r="2.4" fill="var(--fg-faint)" />
              <path d="M8 7.2 15.8 8.6M7.2 8.2 8.6 15.8M16.3 11l-5.6 5.4" stroke="var(--fg-faint)" strokeWidth="1.3" />
            </svg>
            {brandTitle}
          </a>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMuted(toggleMute())}
              className="text-[12px] transition-opacity hover:opacity-70"
              style={{ color: "var(--fg-faint)" }}
              title={muted ? "Unmute sounds" : "Mute sounds"}
            >
              {muted ? "🔇" : "🔈"}
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[14px] transition-colors hover:bg-[var(--line-soft)] md:hidden"
              style={{ color: "var(--fg-faint)" }}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>
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
                className="absolute right-2 top-2.5 flex h-5 w-5 items-center justify-center rounded text-[12px] md:hidden md:group-hover:flex"
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
      </aside>

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
    </>
  );
}
