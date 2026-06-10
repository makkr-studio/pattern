/**
 * SFX — a tiny WebAudio synthesizer giving the admin a voice (mod-admin-spec §14
 * "the UI should feel alive"). No samples, no assets: every sound is a few
 * oscillators with an envelope, so the whole soundscape costs ~0 bytes and never
 * blocks. Volumes are deliberately low — texture, not noise.
 *
 * The AudioContext is created lazily on the first play (which always happens
 * inside a user gesture — clicks, drags, key presses), satisfying autoplay
 * policies. A mute toggle persists in localStorage.
 */

const STORE_KEY = "pattern.admin.sfx";

export type SfxName =
  | "click" // generic button press
  | "nav" // sidebar navigation
  | "open" // modal / palette opens
  | "close" // modal / palette closes
  | "toggle" // theme / switches
  | "add" // node dropped on the canvas
  | "delete" // node/edge removed
  | "connect" // edge snapped between two ports
  | "invalid" // refused connection / validation issue
  | "drag" // picked up from the palette
  | "save" // workflow saved
  | "deploy" // deploy succeeded
  | "run" // run started
  | "ok" // run / action succeeded
  | "error" // run / action failed
  | "undo"
  | "redo";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; master: GainNode } | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16; // global ceiling — everything stays subtle
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, master: master! };
  } catch {
    return null;
  }
}

interface Tone {
  /** Start/end frequency in Hz (sweeps when they differ). */
  f0: number;
  f1?: number;
  type?: OscillatorType;
  /** Duration in seconds. */
  dur: number;
  /** Delay before this tone starts (for arpeggios). */
  at?: number;
  /** Peak gain relative to the master (0..1). */
  gain?: number;
}

function play(tones: Tone[]): void {
  const a = audio();
  if (!a) return;
  const now = a.ctx.currentTime;
  for (const t of tones) {
    const start = now + (t.at ?? 0);
    const osc = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    osc.type = t.type ?? "sine";
    osc.frequency.setValueAtTime(t.f0, start);
    if (t.f1 && t.f1 !== t.f0) osc.frequency.exponentialRampToValueAtTime(t.f1, start + t.dur);
    // Fast attack, exponential decay — clickless and snappy.
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(t.gain ?? 0.5, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, start + t.dur);
    osc.connect(g).connect(a.master);
    osc.start(start);
    osc.stop(start + t.dur + 0.02);
  }
}

/** The soundboard — small, characterful, consistent (rises = creation/success,
 *  falls = removal/cancel, buzzes = refusal/failure, chords = milestones). */
const SOUNDS: Record<SfxName, Tone[]> = {
  click: [{ f0: 2200, dur: 0.035, type: "sine", gain: 0.25 }],
  nav: [{ f0: 1500, dur: 0.03, type: "triangle", gain: 0.2 }],
  open: [{ f0: 360, f1: 640, dur: 0.09, type: "sine", gain: 0.35 }],
  close: [{ f0: 640, f1: 360, dur: 0.09, type: "sine", gain: 0.3 }],
  toggle: [{ f0: 980, dur: 0.05, type: "triangle", gain: 0.3 }],
  add: [
    { f0: 392, f1: 523, dur: 0.08, type: "sine", gain: 0.4 },
    { f0: 784, dur: 0.06, at: 0.05, type: "sine", gain: 0.2 },
  ],
  delete: [{ f0: 330, f1: 150, dur: 0.13, type: "triangle", gain: 0.4 }],
  connect: [
    { f0: 523, dur: 0.05, type: "sine", gain: 0.35 },
    { f0: 784, dur: 0.07, at: 0.045, type: "sine", gain: 0.35 },
  ],
  invalid: [
    { f0: 180, dur: 0.09, type: "square", gain: 0.18 },
    { f0: 165, dur: 0.09, at: 0.07, type: "square", gain: 0.18 },
  ],
  drag: [{ f0: 660, dur: 0.03, type: "triangle", gain: 0.2 }],
  save: [
    { f0: 660, dur: 0.1, type: "sine", gain: 0.35 },
    { f0: 990, dur: 0.16, at: 0.06, type: "sine", gain: 0.3 },
  ],
  deploy: [
    { f0: 523, dur: 0.1, type: "sine", gain: 0.35 },
    { f0: 659, dur: 0.1, at: 0.07, type: "sine", gain: 0.35 },
    { f0: 784, dur: 0.1, at: 0.14, type: "sine", gain: 0.35 },
    { f0: 1047, dur: 0.22, at: 0.21, type: "sine", gain: 0.4 },
  ],
  run: [{ f0: 300, f1: 900, dur: 0.12, type: "sine", gain: 0.3 }],
  ok: [
    { f0: 880, dur: 0.12, type: "sine", gain: 0.35 },
    { f0: 1760, dur: 0.08, at: 0.01, type: "sine", gain: 0.12 },
  ],
  error: [
    { f0: 130, dur: 0.16, type: "square", gain: 0.2 },
    { f0: 98, dur: 0.2, at: 0.1, type: "square", gain: 0.2 },
  ],
  undo: [{ f0: 600, f1: 420, dur: 0.07, type: "triangle", gain: 0.3 }],
  redo: [{ f0: 420, f1: 600, dur: 0.07, type: "triangle", gain: 0.3 }],
};

export const sfx = {
  muted(): boolean {
    try {
      return localStorage.getItem(STORE_KEY) === "off";
    } catch {
      return true;
    }
  },
  setMuted(muted: boolean): void {
    try {
      localStorage.setItem(STORE_KEY, muted ? "off" : "on");
    } catch {
      /* private mode — stay silent */
    }
  },
  play(name: SfxName): void {
    if (sfx.muted()) return;
    play(SOUNDS[name]);
  },
};
