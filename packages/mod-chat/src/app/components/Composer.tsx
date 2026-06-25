/**
 * The composer: Enter sends, Shift+Enter breaks; images paste/drop into
 * preview chips (uploaded as blobs, sent as image_ref parts). While a turn
 * streams, the send button becomes Stop.
 */

import React, { useRef, useState } from "react";
import { api } from "../lib/api";
import { chatStore } from "../lib/store";
import type { MessagePart } from "../lib/types";

interface Attachment {
  blobId: string;
  mime: string;
  uploading?: boolean;
  key: string;
}

export function Composer({ streaming, busy }: { streaming: boolean; busy: boolean }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const canSend = !streaming && (text.trim().length > 0 || attachments.some((a) => !a.uploading));

  /** Push-to-talk: record the mic, then upload + transcribe into the textarea. */
  async function toggleMic() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const { id, meta } = await api.blobs.upload(blob);
          const { text: heard } = await api.transcribe(id, meta.mime);
          if (heard) setText((cur) => (cur ? `${cur} ${heard}` : heard));
          taRef.current?.focus();
        } catch {
          /* transcription unavailable (no "transcription" alias?) — ignore */
        } finally {
          setTranscribing(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      /* mic permission denied / unsupported */
    }
  }

  async function addFiles(files: Iterable<File>) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const key = crypto.randomUUID();
      setAttachments((a) => [...a, { blobId: "", mime: file.type, uploading: true, key }]);
      try {
        const { id } = await api.blobs.upload(file);
        setAttachments((a) => a.map((x) => (x.key === key ? { ...x, blobId: id, uploading: false } : x)));
      } catch {
        setAttachments((a) => a.filter((x) => x.key !== key));
      }
    }
  }

  async function send() {
    if (!canSend) return;
    const parts: MessagePart[] = [];
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    for (const a of attachments) {
      if (!a.uploading && a.blobId) parts.push({ type: "image_ref", blobId: a.blobId, mime: a.mime });
    }
    if (parts.length === 0) return;
    setText("");
    setAttachments([]);
    await chatStore.send(parts);
    taRef.current?.focus();
  }

  return (
    <div className="mx-auto w-full max-w-[44rem] px-5 pb-6">
      {busy && (
        <div
          className="mb-2 flex items-center justify-between rounded-lg border px-3.5 py-2 text-[13.5px]"
          style={{ borderColor: "var(--warn)", color: "var(--fg-soft)", background: "var(--bg-raised)" }}
        >
          <span>A turn is already running on this conversation.</span>
          <button onClick={() => void chatStore.stop()} className="underline" style={{ color: "var(--fg)" }}>
            Stop it
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex gap-2">
          {attachments.map((a) => (
            <div key={a.key} className="relative">
              {a.uploading ? (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-lg border text-[11px]"
                  style={{ borderColor: "var(--line)", color: "var(--fg-faint)" }}
                >
                  …
                </div>
              ) : (
                <img
                  src={api.blobs.url(a.blobId)}
                  alt=""
                  className="h-16 w-16 rounded-lg border object-cover"
                  style={{ borderColor: "var(--line)" }}
                />
              )}
              <button
                onClick={() => setAttachments((x) => x.filter((y) => y.key !== a.key))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px]"
                style={{ background: "var(--bg-raised)", borderColor: "var(--line)", color: "var(--fg-soft)" }}
                aria-label="remove attachment"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="flex items-end gap-2 rounded-2xl border p-2 pl-4 shadow-sm transition-colors focus-within:border-[var(--fg-faint)]"
        style={{ background: "var(--bg-raised)", borderColor: "var(--line)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
      >
        <button
          onClick={() => void toggleMic()}
          disabled={transcribing || streaming}
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-40"
          style={{
            borderColor: recording ? "var(--danger)" : "var(--line)",
            color: recording ? "var(--danger)" : "var(--fg-soft)",
            background: recording ? "var(--danger-soft)" : "transparent",
          }}
          aria-label={recording ? "Stop recording" : "Record voice"}
          title={transcribing ? "Transcribing…" : recording ? "Stop & transcribe" : "Record voice"}
        >
          {transcribing ? (
            <span className="text-[11px]">…</span>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M3 8a5 5 0 0 0 10 0M8 13v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          rows={1}
          placeholder="Message… (drop or paste images)"
          className="max-h-48 min-h-[1.6rem] flex-1 resize-none bg-transparent py-1.5 outline-none placeholder:text-[var(--fg-faint)]"
        />
        {streaming ? (
          <button
            onClick={() => void chatStore.stop()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--danger)" }}
            aria-label="stop"
            title="Stop"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => void send()}
            disabled={!canSend}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            style={{ background: "var(--accent)" }}
            aria-label="send"
            title="Send (Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="mt-1.5 text-center text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  );
}
