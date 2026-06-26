/**
 * The voice conversation loop: always-on mic → VAD end-of-speech → transcribe →
 * send a turn → speak the reply (sentence-chunked TTS), all while driving the
 * avatar's state, color, captions, tool glyphs, and image reveals. Barge-in: if
 * you start talking while it's speaking, the TTS and the in-flight turn stop.
 */

import { api } from "../lib/api";
import { chatStore } from "../lib/store";
import { createVad, type VadController } from "../lib/vad";
import { analyserFromStream, rmsOf, bandsOf } from "../lib/audio";
import type { TurnEvent } from "../lib/types";
import type { Avatar, AvatarState } from "./avatar";
import { emotionGradient, emojiTarget, imageTarget, BRAND_A, BRAND_B, lerpRGB } from "./avatar";

// While a tool runs, cycle through a few glyphs to convey "working / waiting".
const TOOL_CYCLE: Record<string, string[]> = {
  generate_image: ["🎨", "🖌️", "🖼️", "⏳"],
  research: ["🔭", "📚", "⏳"],
  web: ["🔎", "🌐", "⏳"],
  search: ["🔎", "🌐", "⏳"],
};

// Lightweight client-side emotion detection from the streamed reply, so the avatar
// shifts color on its own — no model "express" call required.
const EMOTION_WORDS: Array<[RegExp, string]> = [
  [/\b(amazing|awesome|incredible|fantastic|wow|excellent|brilliant|love it|thrill|can't wait|let's go)\b/i, "excited"],
  [/\b(happy|glad|great|wonderful|delighted|cheer|yay|congrat|perfect|nice work)\b/i, "happy"],
  [/\b(sorry|unfortunately|sad|afraid|regret|apolog|that's tough|bad news)\b/i, "sad"],
  [/\b(calm|relax|gently|peaceful|no worries|take your time|it's okay|don't worry)\b/i, "calm"],
  [/\b(interesting|curious|wonder|hmm|fascinat|let me think|good question)\b/i, "curious"],
  [/\b(careful|caution|warning|important|note that|heads up|be aware)\b/i, "concerned"],
  [/\b(analy|comput|process|calculat|figuring out|working on|looking into)\b/i, "thinking"],
];
function emotionFromText(text: string): string | null {
  for (const [re, emo] of EMOTION_WORDS) if (re.test(text)) return emo;
  if ((text.match(/!/g) ?? []).length >= 2) return "excited";
  if (/\?\s*$/.test(text.trim())) return "curious";
  return null;
}

// Last emoji cluster (base pictographic + ZWJ joins + variation/skin modifiers).
const EMOJI_RE = /\p{Extended_Pictographic}(\u200d\p{Extended_Pictographic}|[\uFE0F\u{1F3FB}-\u{1F3FF}])*/gu;
function lastEmojiOf(text: string): string | null {
  const m = text.match(EMOJI_RE);
  return m && m.length ? (m[m.length - 1] ?? null) : null;
}

function imageRefOf(v: unknown): { blobId: string } | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const isImg = o.kind === "image" || (typeof o.mime === "string" && o.mime.startsWith("image/"));
    if (typeof o.blobId === "string" && isImg) return { blobId: o.blobId };
  }
  return null;
}

export interface VoiceLoopCallbacks {
  onState: (s: AvatarState) => void;
  onCaption: (text: string) => void;
  onToolLabel: (label: string | null) => void;
  onError?: (msg: string) => void;
}

/** Sequential TTS player with an analyser for the avatar's "speaking" reaction. */
class TtsPlayer {
  readonly analyser: AnalyserNode;
  private audio = new Audio();
  private ctx = new AudioContext();
  private queue: string[] = [];
  private playing = false;

  constructor(
    private onStart: () => void,
    private onEnd: () => void,
  ) {
    this.audio.crossOrigin = "anonymous";
    const src = this.ctx.createMediaElementSource(this.audio);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.82;
    src.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.audio.onended = () => void this.next();
    this.audio.onerror = () => void this.next();
  }

  get active(): boolean {
    return this.playing || this.queue.length > 0;
  }

  enqueue(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.queue.push(t);
    if (!this.playing) void this.next();
  }

  private async next(): Promise<void> {
    const t = this.queue.shift();
    if (!t) {
      this.playing = false;
      this.onEnd();
      return;
    }
    this.playing = true;
    let url: string | null = null;
    try {
      const { blobId } = await api.speech(t);
      url = api.blobs.url(blobId);
    } catch {
      url = null;
    }
    if (!url) {
      void this.next();
      return;
    }
    this.audio.src = url;
    this.onStart();
    try {
      await this.ctx.resume();
      await this.audio.play();
    } catch {
      void this.next();
    }
  }

  stop(): void {
    this.queue = [];
    this.audio.pause();
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    void this.ctx.close().catch(() => {});
  }
}

export class VoiceLoop {
  private vad: VadController | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private tts: TtsPlayer;
  private state: AvatarState = "idle";
  private raf = 0;
  private disposed = false;
  private turnActive = false;
  private turnDone = true;
  private assistantBuf = "";
  private caption = "";
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private toolCycleTimer: ReturnType<typeof setInterval> | null = null;
  private presenting = false;
  // Client-side auto-expression bookkeeping.
  private lastEmotion = "";
  private lastEmotionAt = 0;
  private lastEmojiKey = "";
  private lastEmojiAt = 0;
  private micBuf = new Float32Array(1024);
  private micFreq = new Uint8Array(512);
  private ttsBuf = new Float32Array(1024);
  private ttsFreq = new Uint8Array(512);

  constructor(
    private avatar: Avatar,
    private cb: VoiceLoopCallbacks,
    private getModel: () => string | undefined,
  ) {
    this.tts = new TtsPlayer(
      () => this.setState("speaking"),
      () => this.onTtsEnd(),
    );
    this.tick = this.tick.bind(this);
  }

  async start(): Promise<boolean> {
    const vad = await createVad(
      {
        onSpeechStart: () => this.onSpeechStart(),
        onSpeechEnd: (wav) => void this.onUtterance(wav),
      },
      () => this.cb.onError?.("Microphone or speech model unavailable."),
    );
    if (!vad) {
      this.cb.onError?.("Voice mode needs microphone access (and a network connection for the speech model).");
      return false;
    }
    this.vad = vad;
    this.micAnalyser = analyserFromStream(vad.audioContext, vad.stream);
    vad.start();
    this.setState("listening");
    this.raf = requestAnimationFrame(this.tick);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stopToolCycle();
    if (this.morphTimer) clearTimeout(this.morphTimer);
    this.tts.dispose();
    this.vad?.destroy();
    if (this.turnActive) void chatStore.stop();
  }

  private setState(s: AvatarState): void {
    this.state = s;
    this.avatar.set({ state: s });
    this.cb.onState(s);
  }

  private backToListening(): void {
    this.clearMorph();
    this.cb.onToolLabel(null);
    this.setState(this.vad ? "listening" : "idle");
  }

  private clearMorph(): void {
    this.stopToolCycle();
    if (this.morphTimer) {
      clearTimeout(this.morphTimer);
      this.morphTimer = null;
    }
    this.presenting = false;
    this.avatar.set({ morph: null });
  }

  /** A transient morph that reverts after `ms` (unless replaced sooner). */
  private transientMorph(target: Parameters<Avatar["set"]>[0]["morph"], ms: number): void {
    if (this.morphTimer) clearTimeout(this.morphTimer);
    this.avatar.set({ morph: target });
    this.morphTimer = setTimeout(() => {
      this.morphTimer = null;
      if (!this.presenting) this.avatar.set({ morph: null });
    }, ms);
  }

  private onSpeechStart(): void {
    // Barge-in: stop the assistant if it's mid-reply.
    if (this.state === "speaking" || (this.turnActive && !this.turnDone)) {
      this.tts.stop();
      if (this.turnActive) void chatStore.stop();
      this.assistantBuf = "";
    }
    this.cb.onCaption("");
    this.cb.onToolLabel(null);
    this.setState("listening");
  }

  private async onUtterance(wav: Blob): Promise<void> {
    this.setState("thinking");
    try {
      const up = await api.blobs.upload(wav);
      const { text } = await api.transcribe(up.id, up.meta.mime);
      const said = text?.trim();
      if (!said) return this.backToListening();
      this.assistantBuf = "";
      this.caption = "";
      this.cb.onCaption("");
      this.lastEmotion = "";
      this.lastEmojiKey = "";
      this.turnActive = true;
      this.turnDone = false;
      await chatStore.send([{ type: "text", text: said }], {
        model: this.getModel(),
        onEvent: (ev) => this.onEvent(ev),
      });
      this.turnActive = false;
      this.turnDone = true;
      if (this.assistantBuf.trim()) {
        this.tts.enqueue(this.assistantBuf);
        this.assistantBuf = "";
      }
      if (!this.tts.active) this.backToListening();
    } catch {
      this.turnActive = false;
      this.turnDone = true;
      this.backToListening();
    }
  }

  private onEvent(ev: TurnEvent): void {
    if (ev.type === "text.delta") {
      this.assistantBuf += ev.delta;
      this.caption = (this.caption + ev.delta).slice(-280);
      this.cb.onCaption(this.caption);
      this.autoExpress();
      this.maybeSpeakSentence();
    } else if (ev.type === "tool.activity") {
      if (ev.toolName === "express") {
        this.onExpress((ev.phase === "start" ? ev.args : ev.result) as { emotion?: string; emoji?: string } | undefined);
      } else if (ev.phase === "start") {
        this.onToolStart(ev.toolName);
      } else {
        const img = imageRefOf(ev.result);
        if (img) void this.onImage(img.blobId);
        else {
          this.stopToolCycle();
          this.cb.onToolLabel(null);
          if (!this.presenting) this.avatar.set({ morph: null });
        }
      }
    } else if (ev.type === "error") {
      this.cb.onError?.(ev.message);
    }
  }

  private maybeSpeakSentence(): void {
    const buf = this.assistantBuf;
    let idx = -1;
    for (const sep of [". ", "! ", "? ", ".\n", "!\n", "?\n", "…"]) {
      idx = Math.max(idx, buf.lastIndexOf(sep) + (buf.lastIndexOf(sep) >= 0 ? sep.length - 1 : 0));
    }
    if (idx >= 20) {
      const chunk = buf.slice(0, idx + 1);
      this.assistantBuf = buf.slice(idx + 1);
      this.tts.enqueue(chunk);
    }
  }

  /** Shift the gradient toward a mood, subtly (part-way from the brand gradient). */
  private setMood(emotion: string, strength: number): void {
    const [ea, eb] = emotionGradient(emotion);
    this.avatar.set({ color: lerpRGB(BRAND_A, ea, strength), colorB: lerpRGB(BRAND_B, eb, strength) });
  }

  /**
   * Drive the avatar from the reply text itself, so it stays alive without the
   * model having to call `express`: re-read the mood often and shift the gradient
   * a little, and morph briefly to any emoji the assistant actually wrote.
   */
  private autoExpress(): void {
    if (this.presenting) return;
    const now = Date.now();
    if (now - this.lastEmotionAt > 1000) {
      this.lastEmotionAt = now;
      const emo = emotionFromText(this.assistantBuf.slice(-180));
      if (emo && emo !== this.lastEmotion) {
        this.lastEmotion = emo;
        this.setMood(emo, 0.6); // subtle, not full saturation
      }
    }
    if (!this.toolCycleTimer && now - this.lastEmojiAt > 2600) {
      const emo = lastEmojiOf(this.assistantBuf);
      if (emo && emo !== this.lastEmojiKey) {
        this.lastEmojiKey = emo;
        this.lastEmojiAt = now;
        this.transientMorph(emojiTarget(emo, 12000), 3200);
      }
    }
  }

  private onExpress(data?: { emotion?: string; emoji?: string }): void {
    if (!data || typeof data !== "object") return;
    if (data.emotion) this.setMood(data.emotion, 0.78);
    if (data.emoji && !this.presenting) {
      this.transientMorph(emojiTarget(data.emoji, 12000), 4200);
    }
  }

  private onToolStart(toolName: string): void {
    this.cb.onToolLabel(toolName);
    const cycle = TOOL_CYCLE[toolName];
    if (cycle && !this.presenting) this.startToolCycle(cycle, toolName);
  }

  /** Cycle through a tool's glyphs while it runs, to convey "working / waiting". */
  private startToolCycle(list: string[], label: string): void {
    this.stopToolCycle();
    if (this.morphTimer) {
      clearTimeout(this.morphTimer);
      this.morphTimer = null;
    }
    let i = 0;
    const show = () => {
      if (this.presenting) return;
      const glyph = list[i % list.length] ?? list[0]!;
      this.avatar.set({ morph: emojiTarget(glyph, 12000, label) });
      i++;
    };
    show();
    this.toolCycleTimer = setInterval(show, 1500);
  }

  private stopToolCycle(): void {
    if (this.toolCycleTimer) {
      clearInterval(this.toolCycleTimer);
      this.toolCycleTimer = null;
    }
  }

  private async onImage(blobId: string): Promise<void> {
    this.stopToolCycle();
    try {
      const target = await imageTarget(api.blobs.url(blobId), 40000);
      if (this.disposed) return;
      this.presenting = true;
      this.cb.onToolLabel(null);
      this.setState("presenting");
      this.avatar.set({ morph: target });
      if (this.morphTimer) clearTimeout(this.morphTimer);
      this.morphTimer = setTimeout(() => {
        this.morphTimer = null;
        this.presenting = false;
        this.avatar.set({ morph: null });
        this.setState(this.tts.active ? "speaking" : this.vad ? "listening" : "idle");
      }, 4800);
    } catch {
      /* image unreachable — ignore the reveal */
    }
  }

  private onTtsEnd(): void {
    if (this.turnDone && !this.presenting) this.backToListening();
  }

  private tick(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    let level = 0;
    let bands = { bass: 0, mid: 0, treble: 0 };
    if (this.state === "speaking") {
      level = rmsOf(this.tts.analyser, this.ttsBuf) * 4;
      bands = bandsOf(this.tts.analyser, this.ttsFreq);
    } else if ((this.state === "listening" || this.state === "idle") && this.micAnalyser) {
      level = rmsOf(this.micAnalyser, this.micBuf) * 4;
      bands = bandsOf(this.micAnalyser, this.micFreq);
    }
    this.avatar.set({ level: Math.min(1, level), bands, state: this.state });
  }
}
