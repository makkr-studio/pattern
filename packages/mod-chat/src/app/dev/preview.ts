/**
 * Dev-only avatar preview (served at /preview.html by `vite`). A clean fullscreen
 * canvas with state buttons and a faked audio level, so the particle avatar can be
 * tuned visually without the chat shell, a backend, or the mic. Not bundled by the
 * app build (only `index.html` is the build entry).
 */

import { createAvatar, emojiTarget, type Avatar, type AvatarState } from "../voice/avatar";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const dpr = Math.min(2, window.devicePixelRatio || 1);
let avatar: Avatar | null = null;
let level = 0;
let dir = 1;

function fit() {
  avatar?.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener("resize", fit);

void (async () => {
  avatar = await createAvatar(canvas);
  document.title = `Avatar preview (${avatar.backend})`;
  fit();
  // Fake a breathing audio level so reactivity is visible.
  setInterval(() => {
    level += dir * 0.045;
    if (level > 1) dir = -1;
    if (level < 0) dir = 1;
    const l = Math.max(0, level);
    avatar?.set({ level: l, bands: { bass: l, mid: l * 0.6, treble: l * 0.3 } });
  }, 50);
})();

document.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
  b.addEventListener("click", () => {
    const s = b.dataset.s!;
    if (s === "emoji") {
      avatar?.set({ morph: emojiTarget("🎉", 2200) });
      setTimeout(() => avatar?.set({ morph: null }), 4500);
    } else {
      avatar?.set({ state: s as AvatarState, morph: null });
    }
  }),
);
