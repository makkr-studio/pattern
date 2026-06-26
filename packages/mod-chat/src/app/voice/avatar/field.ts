/**
 * Morph-target builders: turn an emoji glyph or an image into a point cloud the
 * particles fly into. Positions are normalized to [-1,1]², aspect-preserved.
 */

import type { MorphTarget } from "./types";

/** Collect opaque pixels from a 2D canvas and resample to exactly `count` points. */
function sampleCanvas(canvas: HTMLCanvasElement, count: number, withColor: boolean): MorphTarget {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const positions = new Float32Array(count * 2);
  const colors = withColor ? new Float32Array(count * 3) : null;
  if (!ctx) return { positions, colors };
  const data = ctx.getImageData(0, 0, w, h).data;

  // Indices of opaque pixels.
  const opaque: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((data[(y * w + x) * 4 + 3] ?? 0) > 80) opaque.push(y * w + x);
    }
  }
  // Aspect-preserving scale into [-1,1].
  const sx = w >= h ? 1 : w / h;
  const sy = h >= w ? 1 : h / w;

  if (opaque.length === 0) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      positions[i * 2] = Math.cos(a) * 0.6;
      positions[i * 2 + 1] = Math.sin(a) * 0.6;
    }
    return { positions, colors };
  }

  for (let i = 0; i < count; i++) {
    const p = opaque[(Math.random() * opaque.length) | 0] ?? 0;
    const x = p % w;
    const y = (p / w) | 0;
    positions[i * 2] = ((x / w) * 2 - 1) * sx;
    positions[i * 2 + 1] = -((y / h) * 2 - 1) * sy;
    if (colors) {
      const idx = p * 4;
      colors[i * 3] = (data[idx] ?? 0) / 255;
      colors[i * 3 + 1] = (data[idx + 1] ?? 0) / 255;
      colors[i * 3 + 2] = (data[idx + 2] ?? 0) / 255;
    }
  }
  return { positions, colors };
}

/** An emoji silhouette as a point cloud (single color). */
export function emojiTarget(emoji: string, count: number, label?: string, size = 168): MorphTarget {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.font = `${Math.floor(size * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  }
  return { ...sampleCanvas(canvas, count, false), label: label ?? null };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** A generated image as a colored point cloud (the "painting" reveal). */
export async function imageTarget(url: string, count: number, size = 110): Promise<MorphTarget> {
  const img = await loadImage(url);
  const ar = img.width / Math.max(1, img.height);
  const w = ar >= 1 ? size : Math.max(1, Math.round(size * ar));
  const h = ar >= 1 ? Math.max(1, Math.round(size / ar)) : size;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(img, 0, 0, w, h);
  return sampleCanvas(canvas, count, true);
}
