/**
 * Dev-only avatar preview (served at /preview.html by `vite`). A clean fullscreen
 * canvas with state buttons and a faked audio level, so the particle avatar can be
 * tuned visually without the chat shell, a backend, or the mic. Not bundled by the
 * app build (only `index.html` is the build entry).
 *
 * The avatar is exposed as `window.__av` so it can be driven deterministically
 * from a console/automation while tuning.
 */

import { createAvatar, emojiTarget, type Avatar, type AvatarState } from "../voice/avatar";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const dpr = window.devicePixelRatio || 1;
let avatar: Avatar | null = null;
let level = 0;
let dir = 1;
let audio = true; // breathing fake-audio on/off (toggle with the "audio" button)
let state: AvatarState = "idle";

function fit() {
  avatar?.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener("resize", fit);

void (async () => {
  avatar = await createAvatar(canvas);
  (window as unknown as { __av: Avatar | null }).__av = avatar;
  document.title = `Avatar preview (${avatar.backend})`;
  fit();
  // Fake a gentle breathing audio level so reactivity is visible without maxing
  // out the drift. Capped well below 1 so the resting look is calm.
  setInterval(() => {
    if (!audio) {
      avatar?.set({ level: 0, bands: { bass: 0, mid: 0, treble: 0 } });
      return;
    }
    level += dir * 0.03;
    if (level > 1) dir = -1;
    if (level < 0) dir = 1;
    const l = Math.max(0, level) * 0.5;
    avatar?.set({ level: l, bands: { bass: l, mid: l * 0.6, treble: l * 0.3 } });
  }, 50);
})();

document.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
  b.addEventListener("click", () => {
    const s = b.dataset.s!;
    if (s === "audio") {
      audio = !audio;
      b.textContent = audio ? "audio: on" : "audio: off";
    } else if (s === "emoji") {
      avatar?.set({ morph: emojiTarget("🎉", 9000) });
      setTimeout(() => avatar?.set({ morph: null }), 6000);
    } else {
      state = s as AvatarState;
      avatar?.set({ state, morph: null });
    }
  }),
);
