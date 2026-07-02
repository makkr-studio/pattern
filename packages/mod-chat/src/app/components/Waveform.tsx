/** A live mic waveform — symmetric bars driven by an AnalyserNode. */

import React, { useEffect, useRef } from "react";
import { rmsOf } from "../lib/audio";

export function Waveform({ analyser, active, color }: { analyser: AnalyserNode | null; active: boolean; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || !active) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = new Float32Array(analyser.fftSize);
    const bars = 24;
    const levels = new Array(bars).fill(0);
    let raf = 0;
    const accent = color ?? (getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#b4552d");

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const level = Math.min(1, rmsOf(analyser, buf) * 3.5);
      levels.push(level);
      levels.shift();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = accent;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = levels[i] ?? 0;
        const bh = Math.max(2, v * h * 0.9);
        const x = i * bw + bw * 0.2;
        ctx.globalAlpha = 0.35 + v * 0.65;
        ctx.fillRect(x, (h - bh) / 2, bw * 0.6, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, active, color]);

  return <canvas ref={canvasRef} width={120} height={28} className="h-7 w-[120px]" />;
}
