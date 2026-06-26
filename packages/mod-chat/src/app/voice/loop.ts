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

// Emoji cluster (base pictographic + ZWJ joins + variation/skin modifiers).
const EMOJI_RE = /\p{Extended_Pictographic}(\u200d\p{Extended_Pictographic}|[\uFE0F\u{1F3FB}-\u{1F3FF}])*/gu;

// Strip emoji (and their joiners/modifiers) from text bound for the TTS \u2014 they
// make some voices emit odd noises.
const EMOJI_STRIP_RE = /[\p{Extended_Pictographic}\u200d\uFE0F\u{1F3FB}-\u{1F3FF}]/gu;
function stripEmoji(text: string): string {
  return text.replace(EMOJI_STRIP_RE, "").replace(/\s{2,}/g, " ").trim();
}

// Mood \u2192 a voice-tone instruction for promptable TTS (e.g. gpt-4o-mini-tts). The
// neutral one alone already lifts the delivery out of a flat monotone.
const TONE: Record<string, string> = {
  neutral: "Speak naturally and conversationally, warm and lightly expressive, not flat.",
  excited: "Speak with bright, upbeat energy and genuine enthusiasm.",
  happy: "Speak warmly and cheerfully, with a smile in your voice.",
  sad: "Speak gently and softly, slower, with empathy.",
  calm: "Speak in a calm, soothing, unhurried tone.",
  curious: "Speak with a light, inquisitive, engaged lilt.",
  concerned: "Speak earnestly and carefully, with a note of concern.",
  thinking: "Speak thoughtfully, at a measured, reflective pace.",
  angry: "Speak firmly and intensely, with controlled force.",
  playful: "Speak playfully, with a teasing, animated bounce.",
};
function toneFor(emotion: string): string {
  return TONE[emotion] ?? TONE.neutral!;
}

// A pool of fun glyphs to sprinkle into a tool's emoji cycle for variety.
const RANDOM_POOL = ["\u2728", "\uD83C\uDF08", "\uD83E\uDE84", "\uD83D\uDCAB", "\uD83C\uDF87", "\uD83C\uDF1F", "\uD83D\uDD2E", "\uD83C\uDF86"];

// Where to cut the next short subtitle phrase from the streaming buffer (0 = wait
// for more). Prefer a sentence end or newline WITHIN a window (so a distant period
// can't pull a whole paragraph); otherwise, for long punctuation-free runs (common
// in lists), break at a clause separator, then a word boundary, near the cap.
const SUB_CAP = 90;
const CLAUSE_SEPS: Array<[string, number]> = [
  [": ", 2],
  ["; ", 2],
  [" - ", 3],
  [" \u2013 ", 3],
  [", ", 2],
];
function phraseCut(buf: string): number {
  const win = buf.slice(0, SUB_CAP + 28);
  const s = win.search(/[.!?\u2026]\s/);
  if (s >= 0) return s + 1;
  const nl = win.indexOf("\n");
  if (nl >= 0) return nl + 1;
  if (buf.length < SUB_CAP) return 0;
  const head = buf.slice(0, SUB_CAP);
  let best = -1;
  for (const [sep, off] of CLAUSE_SEPS) {
    const k = head.lastIndexOf(sep);
    if (k >= 24) best = Math.max(best, k + off);
  }
  if (best >= 0) return best;
  const sp = head.lastIndexOf(" ");
  return sp >= 24 ? sp + 1 : SUB_CAP;
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

interface TtsChunk {
  speak: string; // emoji-stripped text sent to the TTS
  caption: string; // what to show as the synced subtitle (also emoji-stripped)
  tone?: string; // voice-tone instruction (promptable TTS)
  emojis: string[]; // emojis from this line, shown while it is the subtitle
}

/** Sequential TTS player with an analyser for the avatar's "speaking" reaction.
 *  Reports the spoken chunk's caption + its emojis on start, so subtitles track
 *  the audio and the avatar morphs to an emoji while its line is on screen. */
class TtsPlayer {
  readonly analyser: AnalyserNode;
  private audio = new Audio();
  private ctx = new AudioContext();
  private queue: TtsChunk[] = [];
  private playing = false;

  constructor(
    private onStart: (chunk: TtsChunk) => void,
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

  enqueue(text: string, tone?: string): void {
    const speak = stripEmoji(text);
    if (!speak) return; // nothing speakable (e.g. an emoji-only fragment)
    const emojis = text.match(EMOJI_RE) ?? [];
    this.queue.push({ speak, caption: speak, tone, emojis }); // caption is emoji-free
    if (!this.playing) void this.next();
  }

  private async next(): Promise<void> {
    const chunk = this.queue.shift();
    if (!chunk) {
      this.playing = false;
      this.onEnd();
      return;
    }
    this.playing = true;
    let url: string | null = null;
    try {
      const { blobId } = await api.speech(chunk.speak, chunk.tone);
      url = api.blobs.url(blobId);
    } catch {
      url = null;
    }
    if (!url) {
      void this.next();
      return;
    }
    this.audio.src = url;
    this.onStart(chunk);
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
  private assistantBuf = ""; // pending text not yet handed to the TTS (gets sliced)
  private replyText = ""; // the whole reply so far (never sliced) for emoji + mood scans
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private toolCycleTimer: ReturnType<typeof setInterval> | null = null;
  private chunkEmojiTimer: ReturnType<typeof setTimeout> | null = null; // emojis for the current spoken line
  private captionTimer: ReturnType<typeof setTimeout> | null = null; // delayed subtitle fade-out
  private presenting = false;
  // Client-side auto-expression bookkeeping.
  private lastEmotion = "";
  private lastEmotionAt = 0;
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
      (chunk) => {
        if (this.captionTimer) {
          clearTimeout(this.captionTimer);
          this.captionTimer = null;
        }
        this.setState("speaking");
        this.cb.onCaption(chunk.caption); // subtitle tracks the spoken chunk
        this.showLineEmojis(chunk.emojis); // morph to this line's emojis while it shows
      },
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
    if (this.chunkEmojiTimer) clearTimeout(this.chunkEmojiTimer);
    if (this.captionTimer) clearTimeout(this.captionTimer);
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
      this.replyText = "";
    }
    if (this.chunkEmojiTimer) {
      clearTimeout(this.chunkEmojiTimer);
      this.chunkEmojiTimer = null;
    }
    if (this.captionTimer) {
      clearTimeout(this.captionTimer);
      this.captionTimer = null;
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
      this.replyText = "";
      this.lastEmotion = "";
      this.cb.onCaption("");
      // React to the user's own tone right away (so the avatar moves before the reply).
      const userEmo = emotionFromText(said);
      if (userEmo) {
        this.lastEmotion = userEmo;
        this.setMood(userEmo, 0.8);
      }
      this.turnActive = true;
      this.turnDone = false;
      await chatStore.send([{ type: "text", text: said }], {
        model: this.getModel(),
        onEvent: (ev) => this.onEvent(ev),
      });
      this.turnActive = false;
      this.turnDone = true;
      if (this.assistantBuf.trim()) {
        this.tts.enqueue(this.assistantBuf, toneFor(this.lastEmotion || "neutral"));
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
      this.replyText += ev.delta;
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
    // Flush short phrases as soon as they are ready, so the audio and the synced
    // subtitle advance line by line instead of dumping a whole paragraph at once.
    for (;;) {
      const cut = phraseCut(this.assistantBuf);
      if (cut <= 0) break;
      const chunk = this.assistantBuf.slice(0, cut).trim();
      this.assistantBuf = this.assistantBuf.slice(cut);
      if (/[\p{L}\p{N}]/u.test(chunk)) this.tts.enqueue(chunk, toneFor(this.lastEmotion || "neutral"));
    }
  }

  /** Morph to the emojis from the line now on screen, paced if there are several. */
  private showLineEmojis(emojis: string[]): void {
    if (this.chunkEmojiTimer) {
      clearTimeout(this.chunkEmojiTimer);
      this.chunkEmojiTimer = null;
    }
    if (this.presenting || this.toolCycleTimer || !emojis.length) return;
    let i = 0;
    const next = () => {
      if (this.presenting || i >= emojis.length) return;
      const e = emojis[i++];
      if (e) this.transientMorph(emojiTarget(e, 12000), 2600);
      if (i < emojis.length) this.chunkEmojiTimer = setTimeout(next, 1900);
    };
    next();
  }

  /** Shift the gradient toward a mood, subtly (part-way from the brand gradient). */
  private setMood(emotion: string, strength: number): void {
    const [ea, eb] = emotionGradient(emotion);
    this.avatar.set({ color: lerpRGB(BRAND_A, ea, strength), colorB: lerpRGB(BRAND_B, eb, strength) });
  }

  /**
   * Drive the gradient from the reply text itself, so the avatar stays alive
   * without the model having to call `express`: re-read the mood frequently and
   * shift the gradient toward it (emojis are handled separately by the pacer).
   */
  private autoExpress(): void {
    const now = Date.now();
    if (now - this.lastEmotionAt < 850) return;
    this.lastEmotionAt = now;
    const emo = emotionFromText(this.replyText.slice(-220));
    if (emo && emo !== this.lastEmotion) {
      this.lastEmotion = emo;
      this.setMood(emo, 0.85);
    }
  }

  private onExpress(data?: { emotion?: string; emoji?: string }): void {
    if (!data || typeof data !== "object") return;
    if (data.emotion) {
      this.lastEmotion = data.emotion;
      this.setMood(data.emotion, 0.9);
    }
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
      // Every third beat, sprinkle in a random glyph for variety/surprise.
      const glyph =
        i % 3 === 2
          ? (RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)] ?? list[0]!)
          : (list[i % list.length] ?? list[0]!);
      this.avatar.set({ morph: emojiTarget(glyph, 12000, label) });
      i++;
    };
    show();
    this.toolCycleTimer = setInterval(show, 2000);
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
      }, 9000);
    } catch {
      /* image unreachable — ignore the reveal */
    }
  }

  private onTtsEnd(): void {
    if (this.turnDone && !this.presenting) {
      this.backToListening();
      // Let the last subtitle linger a few seconds after the audio stops, then fade.
      if (this.captionTimer) clearTimeout(this.captionTimer);
      this.captionTimer = setTimeout(() => {
        this.captionTimer = null;
        this.cb.onCaption("");
      }, 2600);
    }
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
