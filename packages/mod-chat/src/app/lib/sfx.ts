/** Pattern Chat — zero-asset sounds, deliberately quiet. Mute persists. */

const KEY = "pattern.chat.sfx";
let ctx: AudioContext | undefined;

function muted(): boolean {
  return localStorage.getItem(KEY) === "muted";
}

export function toggleMute(): boolean {
  const next = !muted();
  localStorage.setItem(KEY, next ? "muted" : "on");
  return next;
}

export function isMuted(): boolean {
  return muted();
}

function tone(freq: number, dur: number, gain = 0.025, type: OscillatorType = "sine") {
  if (muted()) return;
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch {
    /* audio is a nicety */
  }
}

export const sfx = {
  send: () => tone(660, 0.07),
  done: () => {
    tone(520, 0.09);
    setTimeout(() => tone(780, 0.12), 70);
  },
  attention: () => {
    tone(440, 0.12, 0.03, "triangle");
    setTimeout(() => tone(440, 0.12, 0.03, "triangle"), 180);
  },
};
