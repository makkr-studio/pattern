/**
 * The transcript — a DOCUMENT, not bubbles. User turns are compact
 * right-anchored marks; agent turns are calm prose along the STRAND: a
 * hairline rail that pulses while streaming and buds where tools fire.
 * Buds expand to their args/result and deep-link into the admin's run view.
 */

import React, { useLayoutEffect, useEffect, useRef, useState } from "react";
import { Volume2, Square, Loader2, Wrench } from "lucide-react";
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

/** A tool result that is a generated-image MediaRef ({ blobId, kind:"image" | image/* mime }). */
function imageRefOf(v: unknown): { blobId: string } | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const isImg = o.kind === "image" || (typeof o.mime === "string" && o.mime.startsWith("image/"));
    if (typeof o.blobId === "string" && isImg) return { blobId: o.blobId };
  }
  return null;
}

function ToolBud({ seg }: { seg: Extract<Segment, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const label =
    seg.phase === "start" ? "running" : seg.phase === "error" ? (seg.error ?? "failed") : "done";
  const image = seg.phase === "done" ? imageRefOf(seg.result) : null;
  return (
    <div className="bud my-1.5" data-phase={seg.phase}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] transition-colors hover:opacity-80"
        style={{ borderColor: "var(--line)", color: "var(--fg-soft)", background: "var(--bg-raised)" }}
      >
        <span className="inline-flex items-center gap-1.5" style={{ fontFamily: "var(--mono)" }}>
          <Wrench size={12} /> {seg.toolName}
        </span>
        <span style={{ color: seg.phase === "error" ? "var(--danger)" : "var(--fg-faint)" }}>{label}</span>
      </button>
      {image && (
        <img
          src={api.blobs.url(image.blobId)}
          alt="generated"
          className="my-2 block max-h-80 rounded-lg border"
          style={{ borderColor: "var(--line)" }}
        />
      )}
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

// Per-message TTS cache: re-clicking "listen" replays the same generated audio
// instead of regenerating it. Keyed by turn id, session-lifetime (cleared on reload).
const speechCache = new Map<string, string>(); // turnId -> blobId

/** Play an assistant turn aloud (text-to-speech via the "speech" alias). */
function SpeakButton({ text, messageId }: { text: string; messageId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  async function toggle() {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      let blobId = speechCache.get(messageId);
      if (!blobId) {
        ({ blobId } = await api.speech(text));
        speechCache.set(messageId, blobId);
      }
      const audio = new Audio(api.blobs.url(blobId));
      audioRef.current = audio;
      audio.onended = () => setState("idle");
      await audio.play();
      setState("playing");
    } catch {
      setState("idle");
    }
  }
  return (
    <button
      onClick={() => void toggle()}
      className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-80"
      style={{ color: "var(--fg-faint)" }}
      title={state === "playing" ? "Stop" : "Read aloud"}
      aria-label={state === "playing" ? "Stop" : "Read aloud"}
    >
      {state === "loading" ? <Loader2 size={13} className="animate-spin" /> : state === "playing" ? <Square size={13} /> : <Volume2 size={14} />}
    </button>
  );
}

function AgentTurn({ turn, live }: { turn: Turn; live: boolean }) {
  const segments = segmentsOf(turn.events, live);
  const status = turn.status;
  const retry = () => {
    const parts = turn.input;
    if (parts.length) void chatStore.send(parts);
  };
  const spokenText = segments
    .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("\n")
    .trim();
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
      {!live && status === "complete" && spokenText && <SpeakButton text={spokenText} messageId={turn.id} />}
      {status === "cancelled" && (
        <div className="mt-1 text-[12.5px] italic" style={{ color: "var(--fg-faint)" }}>
          stopped
        </div>
      )}
    </div>
  );
}

/**
 * Reading-first scroll model. Sending a message anchors it at the TOP of the
 * viewport — once — and the answer streams into space that already exists,
 * so the container never scrolls under the reader.
 *
 * The trick is what we DON'T do: no reserved-padding math against a response
 * of unknown length, and no pin-to-bottom loop. The last exchange block gets
 * `min-height ≈ viewport` while it's the anchored one — a short answer leaves
 * quiet space below (breathing room), a long one grows past the fold and the
 * reader scrolls when THEY choose. Opening a conversation still lands at the
 * end (dense, no reservation); the reservation only exists for turns sent in
 * this session, and migrates forward on the next send — any collapse of the
 * old block happens at the exact moment we're scrolling anyway.
 */
export function Transcript({ turns, liveTurnId }: { turns: Turn[]; liveTurnId: string | null }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const [anchoredId, setAnchoredId] = useState<string | null>(null);
  const prev = useRef<{ conv?: string; last?: string }>({});

  const last = turns.at(-1);
  const convId = turns[0]?.conversationId;

  // The scroller's height IS the reservation — track it through resizes
  // (mobile keyboards, window drags) so the anchor stays reachable.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // useLayoutEffect (not useEffect): set the anchor — and thus reserve the
  // min-height — in the SAME commit the new turn paints in. With useEffect the
  // reservation landed a frame late, so the area briefly collapsed to 0 (content
  // dropped then snapped up) — that flash is what this fixes.
  useLayoutEffect(() => {
    if (!last) return;
    const sameConv = prev.current.conv === convId;
    const newLast = prev.current.last !== last.id;
    prev.current = { conv: convId, last: last.id };
    if (!sameConv) {
      // Switched/opened a conversation: land at the end, no reservation.
      setAnchoredId(null);
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
      return;
    }
    // A turn WE just sent (liveTurnId is set synchronously with it) → anchor.
    if (newLast && last.id === liveTurnId) setAnchoredId(last.id);
  }, [convId, last, liveTurnId]);

  // Scroll AFTER the min-height committed, so "top" is actually reachable.
  useLayoutEffect(() => {
    if (anchoredId) lastRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [anchoredId]);

  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[44rem] flex-col gap-7 px-5 py-8">
        {turns.map((turn) => {
          const isLast = turn.id === last?.id;
          return (
            <div
              key={turn.id}
              ref={isLast ? lastRef : undefined}
              className="flex scroll-mt-3 flex-col gap-7"
              style={
                isLast && anchoredId === turn.id && viewport
                  ? { minHeight: Math.max(0, viewport - 60) }
                  : undefined
              }
            >
              <UserMessage input={turn.input} />
              <AgentTurn turn={turn} live={liveTurnId === turn.id} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
