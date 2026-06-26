/**
 * Fullscreen voice mode: a GPU particle avatar over the whole UI, an always-on
 * mic conversation (VAD → transcribe → reply → speak), live captions, tool
 * glyphs, and image reveals. Mounted lazily so WebGPU + the VAD model load only
 * when entered. Esc or the close button exits.
 */

import React, { useEffect, useRef, useState } from "react";
import { X, Wrench } from "lucide-react";
import { createAvatar, type Avatar, type AvatarState } from "./avatar";
import { VoiceLoop } from "./loop";
import { chatStore } from "../lib/store";

const STATE_LABEL: Record<AvatarState, string> = {
  idle: "",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  presenting: "",
};

export default function VoiceMode({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<AvatarState>("idle");
  const [caption, setCaption] = useState("");
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<"webgpu" | "canvas2d" | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let avatar: Avatar | null = null;
    let loop: VoiceLoop | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;

    requestAnimationFrame(() => setShown(true));

    void (async () => {
      const a = await createAvatar(canvas);
      if (cancelled) {
        a.dispose();
        return;
      }
      avatar = a;
      setBackend(a.backend);
      const fit = () => {
        const r = wrap.getBoundingClientRect();
        // Native device pixels (1:1, no upscale) so the point cloud stays crisp.
        a.resize(r.width, r.height, window.devicePixelRatio || 1);
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(wrap);
      loop = new VoiceLoop(
        a,
        { onState: setState, onCaption: setCaption, onToolLabel: setToolLabel, onError: setError },
        () => chatStore.getState().selectedModel ?? undefined,
      );
      await loop.start();
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      loop?.dispose();
      avatar?.dispose();
    };
  }, []);

  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] transition-opacity duration-300" style={{ background: "#050407", opacity: shown ? 1 : 0 }}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          {backend === "webgpu" && (
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
              WebGPU
            </span>
          )}
          {toolLabel && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <Wrench size={11} /> {toolLabel}
            </span>
          )}
        </div>
        <button
          onClick={close}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          style={{ color: "rgba(255,255,255,0.7)" }}
          aria-label="Exit voice mode"
          title="Exit (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      {STATE_LABEL[state] && (
        <div
          className="pointer-events-none absolute inset-x-0 top-20 text-center text-[12px] uppercase tracking-[0.32em]"
          style={{ color: "rgba(255,255,255,0.32)" }}
        >
          {STATE_LABEL[state]}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-12">
        <div
          className="mx-auto max-w-2xl text-center text-[18px] leading-relaxed"
          style={{ color: "rgba(255,255,255,0.86)", textShadow: "0 2px 22px rgba(0,0,0,0.65)" }}
        >
          {caption}
        </div>
        {error && (
          <div className="mx-auto mt-3 max-w-md text-center text-[13px]" style={{ color: "#e8a0a0" }}>
            {error}
          </div>
        )}
        {!caption && !error && (
          <div className="mx-auto max-w-md text-center text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            Say something. I&apos;m listening.
          </div>
        )}
      </div>
    </div>
  );
}
