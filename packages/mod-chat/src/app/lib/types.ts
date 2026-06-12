/**
 * Pattern Chat — client-side shapes (mirrors of the backend's wire formats;
 * the SPA never imports backend code).
 */

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image_ref"; blobId: string; mime?: string };

export type TurnStatus = "running" | "complete" | "error" | "interrupted" | "cancelled";

export type TurnEvent =
  | { type: "text.delta"; turnId: string; runId: string; delta: string }
  | { type: "text.done"; turnId: string; runId: string; text: string }
  | {
      type: "tool.activity";
      turnId: string;
      runId: string;
      toolName: string;
      callId?: string;
      phase: "start" | "done" | "error";
      args?: unknown;
      result?: unknown;
      error?: string;
      subRunId?: string;
    }
  | { type: "audio.ref"; turnId: string; runId: string; blobId: string; mime: string }
  | {
      type: "approval.request";
      turnId: string;
      runId: string;
      interruption: { id: string; toolName: string; args: unknown };
      stateToken: string;
    }
  | { type: "error"; turnId: string; runId: string; message: string; code?: string }
  | {
      type: "done";
      turnId: string;
      runId: string;
      stopReason: "complete" | "interrupted" | "error" | "cancelled";
    };

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  historyLength: number;
}

export interface Turn {
  id: string;
  conversationId: string;
  runId: string;
  input: MessagePart[];
  events: TurnEvent[];
  status: TurnStatus;
  createdAt: number;
  endedAt: number | null;
}

/* ── render model: a turn reduced to displayable segments ─────────────── */

export type Segment =
  | { kind: "text"; text: string; streaming: boolean }
  | {
      kind: "tool";
      toolName: string;
      callId?: string;
      phase: "start" | "done" | "error";
      args?: unknown;
      result?: unknown;
      error?: string;
      subRunId?: string;
    }
  | { kind: "approval"; interruptionId: string; toolName: string; args: unknown; resolved: boolean }
  | { kind: "error"; message: string; code?: string };

/** Fold an event log (live or replayed) into render segments. */
export function segmentsOf(events: TurnEvent[], live: boolean): Segment[] {
  const out: Segment[] = [];
  let acc = "";
  let resolvedApprovals = 0;

  const closeText = (streaming: boolean) => {
    if (acc) {
      out.push({ kind: "text", text: acc, streaming });
      acc = "";
    }
  };

  for (const ev of events) {
    switch (ev.type) {
      case "text.delta":
        acc += ev.delta;
        break;
      case "text.done":
        acc = "";
        out.push({ kind: "text", text: ev.text, streaming: false });
        break;
      case "tool.activity": {
        closeText(false);
        const open = out.find(
          (s): s is Extract<Segment, { kind: "tool" }> =>
            s.kind === "tool" &&
            s.phase === "start" &&
            (ev.callId ? s.callId === ev.callId : s.toolName === ev.toolName),
        );
        if (ev.phase !== "start" && open) {
          open.phase = ev.phase;
          open.result = ev.result;
          open.error = ev.error;
          open.subRunId = ev.subRunId ?? open.subRunId;
        } else {
          out.push({
            kind: "tool",
            toolName: ev.toolName,
            callId: ev.callId,
            phase: ev.phase,
            args: ev.args,
            result: ev.result,
            error: ev.error,
            subRunId: ev.subRunId,
          });
        }
        break;
      }
      case "approval.request":
        closeText(false);
        out.push({
          kind: "approval",
          interruptionId: ev.interruption.id,
          toolName: ev.interruption.toolName,
          args: ev.interruption.args,
          resolved: false,
        });
        break;
      case "error":
        closeText(false);
        out.push({ kind: "error", message: ev.message, code: ev.code });
        break;
      case "done":
        // A second `done` means an approval round resolved earlier requests.
        if (resolvedApprovals === 0) {
          resolvedApprovals++;
        } else {
          for (const s of out) if (s.kind === "approval") s.resolved = true;
        }
        break;
      default:
        break;
    }
  }
  // Trailing accumulated delta = the streaming tail.
  if (acc) out.push({ kind: "text", text: acc, streaming: live });
  // Approvals are resolved once the turn isn't interrupted anymore.
  return out;
}
