/** Pick a renderer: custom WGSL (WebGPU) when it works, else Canvas2D. */

import type { Avatar } from "./types";
import { Canvas2DAvatar } from "./canvas2d";

export type { Avatar, AvatarState, AvatarInputs, MorphTarget, RGB } from "./types";
export { emotionColor, emotionGradient, lerpRGB, BRAND, BRAND_A, BRAND_B } from "./palette";
export { emojiTarget, imageTarget } from "./field";

export async function createAvatar(canvas: HTMLCanvasElement): Promise<Avatar> {
  if ("gpu" in navigator) {
    try {
      const { createWebGPUAvatar } = await import("./webgpu");
      return await createWebGPUAvatar(canvas);
    } catch (e) {
      console.warn("[pattern/chat] WebGPU avatar unavailable — using Canvas2D", e);
    }
  }
  return new Canvas2DAvatar(canvas);
}
