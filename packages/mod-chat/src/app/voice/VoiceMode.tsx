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
  const capBoxRef = useRef<HTMLDivElement>(null); // 2-line clip window
  const capInnerRef = useRef<HTMLDivElement>(null); // full-text inner, scrolled by translateY
  const [state, setState] = useState<AvatarState>("idle");
  const [caption, setCaption] = useState("");
  const [capOn, setCapOn] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null); // full image crossfaded over the cloud
  const [pictureOn, setPictureOn] = useState(false);
  const [pictureBox, setPictureBox] = useState<{ w: number; h: number } | null>(null); // cloud footprint, px
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
        {
          onState: setState,
          // Subtitle: show the spoken line; an empty string fades it out (audio stopped).
          onCaption: (t: string) => {
            if (t) {
              if (capInnerRef.current) capInnerRef.current.style.transform = "translateY(0)"; // reset scroll
              setCaption(t);
              setCapOn(true);
            } else {
              setCapOn(false);
            }
          },
          // Decoupled from the TTS chunking: scroll the (possibly long) line through
          // the fixed 2-line window as its audio plays, so nothing is clipped away.
          onCaptionScroll: (p: number) => {
            const inner = capInnerRef.current;
            const box = capBoxRef.current;
            if (!inner || !box) return;
            const overflow = inner.scrollHeight - box.clientHeight;
            inner.style.transform = `translateY(${overflow > 2 ? -overflow * p : 0}px)`;
          },
          onToolLabel: setToolLabel,
          // Crossfade the full generated picture up over the dotted cloud, then back.
          // Sizing happens on load (so the <img> matches the cloud's footprint
          // exactly); the fade-in only then triggers, for a smooth, aligned reveal.
          onPicture: (url: string | null) => {
            if (url) {
              setPictureOn(false);
              setPictureBox(null);
              setPictureUrl(url);
            } else {
              setPictureOn(false);
            }
          },
          onError: setError,
        },
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

  // Size the full picture to the dotted cloud's exact on-screen footprint. Both
  // renderers fit the cloud to min(width,height): WebGPU draws at world·0.82·asp,
  // canvas2d at min(W,H)·0.4 (≈0.80 full-width). The image's aspect ratio sets how
  // much of that square it fills (px,py ≤ 1), so the <img> lands right on the dots.
  const measurePicture = (img: HTMLImageElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const minDim = Math.min(r.width, r.height);
    const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
    const px = ar >= 1 ? 1 : ar;
    const py = ar >= 1 ? 1 / ar : 1;
    const fit = backend === "canvas2d" ? 0.8 : 0.82;
    setPictureBox({ w: px * fit * minDim, h: py * fit * minDim });
  };

  return (
    <div className="fixed inset-0 z-[60] transition-opacity duration-300" style={{ background: "#050407", opacity: shown ? 1 : 0 }}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {pictureUrl && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <img
            src={pictureUrl}
            alt=""
            onLoad={(e) => {
              measurePicture(e.currentTarget);
              requestAnimationFrame(() => setPictureOn(true)); // fade in only once sized
            }}
            onTransitionEnd={() => {
              if (!pictureOn) setPictureUrl(null); // unmount once fully faded back to the cloud
            }}
            className="rounded-xl"
            style={{
              width: pictureBox ? `${pictureBox.w}px` : undefined,
              height: pictureBox ? `${pictureBox.h}px` : undefined,
              objectFit: "contain",
              opacity: pictureOn ? 1 : 0,
              transition: "opacity 1100ms ease-in-out",
              boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      )}

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
          ref={capBoxRef}
          className="mx-auto max-w-xl overflow-hidden text-center text-[17px] transition-opacity duration-500"
          style={{ opacity: capOn ? 1 : 0, height: "3.4em", lineHeight: "1.7em" }}
        >
          <div
            ref={capInnerRef}
            style={{
              color: "rgba(255,255,255,0.92)",
              textShadow: "0 2px 22px rgba(0,0,0,0.85)",
              lineHeight: "1.7em",
              willChange: "transform",
            }}
          >
            {caption}
          </div>
        </div>
        {error && (
          <div className="mx-auto mt-3 max-w-md text-center text-[13px]" style={{ color: "#e8a0a0" }}>
            {error}
          </div>
        )}
        {!capOn && !error && (
          <div className="mx-auto max-w-md text-center text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            Say something. I&apos;m listening.
          </div>
        )}
      </div>
    </div>
  );
}
