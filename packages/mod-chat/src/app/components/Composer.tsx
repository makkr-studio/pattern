/**
 * The composer: Enter sends, Shift+Enter breaks; images paste/drop into
 * preview chips (uploaded as blobs, sent as image_ref parts). While a turn
 * streams, the send button becomes Stop.
 *
 * The mic uses an on-device VAD (Silero) that detects the end of speech and
 * transcribes each utterance into the textarea — a live waveform shows it's
 * listening. If the VAD model can't load it falls back to push-to-talk.
 */

import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, ArrowUp, Loader2, X } from "lucide-react";
import { api } from "../lib/api";
import { chatStore } from "../lib/store";
import { createVad, type VadController } from "../lib/vad";
import { analyserFromStream } from "../lib/audio";
import { brandTitle } from "../lib/config";
import { Waveform } from "./Waveform";
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
  const vadRef = useRef<VadController | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const manualCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const canSend = !streaming && (text.trim().length > 0 || attachments.some((a) => !a.uploading));

  async function transcribeBlob(blob: Blob) {
    if (!blob.size) return;
    setTranscribing(true);
    try {
      const { id, meta } = await api.blobs.upload(blob);
      const { text: heard } = await api.transcribe(id, meta.mime);
      if (heard) setText((cur) => (cur ? `${cur} ${heard}` : heard).trim());
      taRef.current?.focus();
    } catch {
      /* transcription unavailable (no "transcription" alias?) — ignore */
    } finally {
      setTranscribing(false);
    }
  }

  function stopMic() {
    vadRef.current?.destroy();
    vadRef.current = null;
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    if (manualCtxRef.current) {
      void manualCtxRef.current.close().catch(() => {});
      manualCtxRef.current = null;
    }
    setAnalyser(null);
    setRecording(false);
  }

  /** Push-to-talk fallback when the VAD model can't load. */
  async function startManual() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    manualCtxRef.current = ctx;
    setAnalyser(analyserFromStream(ctx, stream));
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
      manualCtxRef.current = null;
      setAnalyser(null);
      setRecording(false);
      await transcribeBlob(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  async function toggleMic() {
    if (recording) {
      // VAD: stop listening (utterances already transcribed). Manual: stop fires
      // its onstop, which transcribes the single take.
      if (vadRef.current) stopMic();
      else recRef.current?.stop();
      return;
    }
    try {
      const vad = await createVad(
        { onSpeechEnd: (wav) => void transcribeBlob(wav) },
        (e) => console.warn("[pattern/chat] VAD unavailable — falling back to push-to-talk", e),
      );
      if (vad) {
        vadRef.current = vad;
        setAnalyser(analyserFromStream(vad.audioContext, vad.stream));
        vad.start();
        setRecording(true);
      } else {
        await startManual();
      }
    } catch {
      /* mic permission denied / unsupported */
    }
  }

  // Release the mic if the composer unmounts mid-recording.
  useEffect(() => () => stopMic(), []);

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
                  className="flex h-16 w-16 items-center justify-center rounded-lg border"
                  style={{ borderColor: "var(--line)", color: "var(--fg-faint)" }}
                >
                  <Loader2 size={16} className="animate-spin" />
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
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border"
                style={{ background: "var(--bg-raised)", borderColor: "var(--line)", color: "var(--fg-soft)" }}
                aria-label="remove attachment"
              >
                <X size={11} />
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
          disabled={streaming}
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-40"
          style={{
            borderColor: recording ? "var(--accent)" : "var(--line)",
            color: recording ? "var(--accent)" : "var(--fg-soft)",
            background: recording ? "var(--accent-soft)" : "transparent",
          }}
          aria-label={recording ? "Stop listening" : "Speak"}
          title={transcribing ? "Transcribing…" : recording ? "Stop listening" : "Speak (auto-detects when you stop)"}
        >
          {transcribing ? <Loader2 size={15} className="animate-spin" /> : recording ? <Square size={14} /> : <Mic size={15} />}
        </button>
        {recording ? (
          <div className="flex flex-1 items-center gap-2 py-1.5">
            <Waveform analyser={analyser} active={recording} />
            <span className="text-[13px]" style={{ color: "var(--fg-faint)" }}>
              {transcribing ? "transcribing…" : "listening…"}
            </span>
          </div>
        ) : (
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
            placeholder={`Message ${brandTitle}…`}
            className="max-h-48 min-h-[1.6rem] flex-1 resize-none bg-transparent py-1.5 outline-none placeholder:text-[var(--fg-faint)]"
          />
        )}
        {streaming ? (
          <button
            onClick={() => void chatStore.stop()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--danger)" }}
            aria-label="stop"
            title="Stop"
          >
            <Square size={13} fill="currentColor" />
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
            <ArrowUp size={16} />
          </button>
        )}
      </div>
      <div className="mt-1.5 text-center text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  );
}
