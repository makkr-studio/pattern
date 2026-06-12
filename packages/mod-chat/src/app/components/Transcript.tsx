/**
 * The transcript — a DOCUMENT, not bubbles. User turns are compact
 * right-anchored marks; agent turns are calm prose along the STRAND: a
 * hairline rail that pulses while streaming and buds where tools fire.
 * Buds expand to their args/result and deep-link into the admin's run view.
 */

import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { chatStore } from "../lib/store";
import { segmentsOf, type MessagePart, type Segment, type Turn } from "../lib/types";
import { Markdown } from "../lib/md";

function UserMessage({ input }: { input: MessagePart[] }) {
  return (
    <div className="flex justify-end turn-enter">
      <div
        className="max-w-[78%] rounded-2xl rounded-br-md px-4 py-2.5 text-[15.5px]"
        style={{ background: "var(--user-chip)" }}
      >
        {input.map((p, i) =>
          p.type === "text" ? (
            <span key={i} className="whitespace-pre-wrap">
              {p.text}
            </span>
          ) : (
            <img
              key={i}
              src={api.blobs.url(p.blobId)}
              alt="attachment"
              className="my-1.5 max-h-64 rounded-lg border"
              style={{ borderColor: "var(--line)" }}
            />
          ),
        )}
      </div>
    </div>
  );
}

function ToolBud({ seg }: { seg: Extract<Segment, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const label =
    seg.phase === "start" ? "running" : seg.phase === "error" ? (seg.error ?? "failed") : "done";
  return (
    <div className="bud my-1.5" data-phase={seg.phase}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] transition-colors hover:opacity-80"
        style={{ borderColor: "var(--line)", color: "var(--fg-soft)", background: "var(--bg-raised)" }}
      >
        <span style={{ fontFamily: "var(--mono)" }}>⚙ {seg.toolName}</span>
        <span style={{ color: seg.phase === "error" ? "var(--danger)" : "var(--fg-faint)" }}>{label}</span>
      </button>
      {open && (
        <div
          className="mt-1.5 rounded-lg border p-3 text-[12.5px]"
          style={{ borderColor: "var(--line)", background: "var(--bg-raised)", fontFamily: "var(--mono)" }}
        >
          {seg.args !== undefined && (
            <div className="mb-1.5">
              <span style={{ color: "var(--fg-faint)" }}>args </span>
              <span className="whitespace-pre-wrap break-all">{JSON.stringify(seg.args)}</span>
            </div>
          )}
          {seg.result !== undefined && (
            <div>
              <span style={{ color: "var(--fg-faint)" }}>result </span>
              <span className="whitespace-pre-wrap break-all">{JSON.stringify(seg.result)}</span>
            </div>
          )}
          {seg.error && <div style={{ color: "var(--danger)" }}>{seg.error}</div>}
          {seg.subRunId && (
            <a
              href={`/admin/runs/${seg.subRunId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block underline"
              style={{ color: "var(--fg-soft)" }}
            >
              open run in admin ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  seg,
  turn,
  live,
}: {
  seg: Extract<Segment, { kind: "approval" }>;
  turn: Turn;
  live: boolean;
}) {
  const pending = turn.status === "interrupted" && !seg.resolved && !live;
  return (
    <div className="bud my-2" data-kind="approval">
      <div
        className="rounded-xl border px-4 py-3"
        style={{ borderColor: "var(--warn)", background: "var(--bg-raised)" }}
      >
        <div className="text-[14px]" style={{ color: "var(--fg)" }}>
          The agent wants to run <code style={{ fontFamily: "var(--mono)" }}>{seg.toolName}</code>
          {seg.args != null && (
            <span style={{ color: "var(--fg-soft)", fontFamily: "var(--mono)", fontSize: "12.5px" }}>
              {" "}
              {JSON.stringify(seg.args)}
            </span>
          )}
        </div>
        {pending ? (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void chatStore.approve(turn.id, seg.interruptionId, true)}
              className="rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--ok)" }}
            >
              Approve
            </button>
            <button
              onClick={() => void chatStore.approve(turn.id, seg.interruptionId, false)}
              className="rounded-lg border px-3.5 py-1.5 text-[13.5px] transition-opacity hover:opacity-80"
              style={{ borderColor: "var(--line)", color: "var(--fg-soft)" }}
            >
              Deny
            </button>
          </div>
        ) : (
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--fg-faint)" }}>
            {turn.status === "interrupted" ? "awaiting decision…" : "resolved"}
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorCard({ seg, onRetry }: { seg: Extract<Segment, { kind: "error" }>; onRetry?: () => void }) {
  const hint =
    seg.code === "guardrail.input"
      ? "Blocked by an input guardrail."
      : seg.code === "guardrail.output"
        ? "The reply was blocked by an output guardrail."
        : seg.code === "max_turns"
          ? "The agent hit its tool-call limit."
          : undefined;
  return (
    <div
      className="my-2 rounded-xl border px-4 py-3 text-[14px]"
      style={{ borderColor: "var(--danger)", background: "var(--danger-soft)", color: "var(--fg)" }}
    >
      <div className="font-medium" style={{ color: "var(--danger)" }}>
        {hint ?? "Something went wrong"}
      </div>
      <div className="mt-0.5 text-[13px]" style={{ color: "var(--fg-soft)" }}>
        {seg.message}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 text-[13px] underline" style={{ color: "var(--fg-soft)" }}>
          Retry
        </button>
      )}
    </div>
  );
}

function AgentTurn({ turn, live }: { turn: Turn; live: boolean }) {
  const segments = segmentsOf(turn.events, live);
  const status = turn.status;
  const retry = () => {
    const parts = turn.input;
    if (parts.length) void chatStore.send(parts);
  };
  return (
    <div className="strand pl-6 turn-enter" data-live={live || undefined} data-status={status}>
      {segments.length === 0 && live && (
        <div className="caret text-[15px]" style={{ color: "var(--fg-faint)" }} />
      )}
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <div key={i} className={seg.streaming ? "caret" : undefined}>
              <Markdown text={seg.text} />
            </div>
          );
        }
        if (seg.kind === "tool") return <ToolBud key={i} seg={seg} />;
        if (seg.kind === "approval") return <ApprovalCard key={i} seg={seg} turn={turn} live={live} />;
        return <ErrorCard key={i} seg={seg} onRetry={status !== "running" ? retry : undefined} />;
      })}
      {status === "cancelled" && (
        <div className="mt-1 text-[12.5px] italic" style={{ color: "var(--fg-faint)" }}>
          stopped
        </div>
      )}
    </div>
  );
}

export function Transcript({ turns, liveTurnId }: { turns: Turn[]; liveTurnId: string | null }) {
  const endRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Stay pinned to the bottom while streaming — unless the user scrolled up.
  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  });

  return (
    <div
      className="h-full overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="mx-auto flex max-w-[44rem] flex-col gap-7 px-5 py-8">
        {turns.map((turn) => (
          <React.Fragment key={turn.id}>
            <UserMessage input={turn.input} />
            <AgentTurn turn={turn} live={liveTurnId === turn.id} />
          </React.Fragment>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
