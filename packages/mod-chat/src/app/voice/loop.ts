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
// Sticky variant: matches an emoji cluster only at an exact position.
const EMOJI_AT = /\p{Extended_Pictographic}(\u200d\p{Extended_Pictographic}|[\uFE0F\u{1F3FB}-\u{1F3FF}])*/uy;

/** Advance past an emoji run (clusters + the spaces between/after them) starting at
 *  `k`, so a sentence keeps the emojis that trail it instead of handing them to the
 *  next chunk as leading (frac-0) emojis. */
function absorbTrailingEmojis(buf: string, k: number): number {
  let j = k;
  for (;;) {
    EMOJI_AT.lastIndex = j;
    if (!EMOJI_AT.test(buf)) break;
    j = EMOJI_AT.lastIndex;
    while (j < buf.length && /[ \t]/.test(buf[j]!)) j++;
  }
  return j;
}

// Strip emoji (and their joiners/modifiers) from text bound for the TTS \u2014 they
// make some voices emit odd noises.
const EMOJI_STRIP_RE = /[\p{Extended_Pictographic}\u200d\uFE0F\u{1F3FB}-\u{1F3FF}]/gu;
function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_STRIP_RE, "")
    .replace(/ +([.,])/g, "$1") // an emoji between a word and its period leaves a stray space
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Strip Markdown syntax so neither the captions nor the TTS read out literal
// asterisks, backticks, hashes, or link URLs. Emojis are preserved here (they're
// removed separately, after we've measured their position for the morph timing).
function stripMarkdown(text: string): string {
  let t = text;
  t = t.replace(/```[^\n]*\n?/g, ""); // fenced-code delimiters (keep the inner lines)
  t = t.replace(/`([^`]+)`/g, "$1"); // inline code -> its text
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // image -> alt
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // link -> label
  t = t.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)(.+?)\1/g, "$2"); // emphasis -> inner text
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ""); // headings
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, ""); // blockquotes
  t = t.replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, ""); // list markers
  t = t.replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ""); // horizontal rules
  t = t.replace(/[*_`#]+/g, ""); // stray leftover emphasis/heading chars
  return t.replace(/[ \t]{2,}/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

// Mood \u2192 a voice-tone instruction for promptable TTS (e.g. gpt-4o-mini-tts). The
// neutral one alone already lifts the delivery out of a flat monotone.
const PACE = " Keep a brisk, natural conversational pace.";
const TONE: Record<string, string> = {
  neutral: "Speak naturally and conversationally, warm and lightly expressive, not flat." + PACE,
  excited: "Speak with bright, upbeat energy and genuine enthusiasm." + PACE,
  happy: "Speak warmly and cheerfully, with a smile in your voice." + PACE,
  sad: "Speak gently and softly, with empathy, at an unhurried pace.",
  calm: "Speak in a calm, soothing tone, at a relaxed pace.",
  curious: "Speak with a light, inquisitive, engaged lilt." + PACE,
  concerned: "Speak earnestly and carefully, with a note of concern." + PACE,
  thinking: "Speak thoughtfully, at a measured pace.",
  angry: "Speak firmly and intensely, with controlled force." + PACE,
  playful: "Speak playfully, with a teasing, animated bounce." + PACE,
};
function toneFor(emotion: string): string {
  return TONE[emotion] ?? TONE.neutral!;
}

// A pool of fun glyphs to sprinkle into a tool's emoji cycle for variety.
const RANDOM_POOL = ["\u2728", "\uD83C\uDF08", "\uD83E\uDE84", "\uD83D\uDCAB", "\uD83C\uDF87", "\uD83C\uDF1F", "\uD83D\uDD2E", "\uD83C\uDF86"];

// Abbreviations (FR + EN) whose trailing period does NOT end a sentence, so we
// don't cut "Bonjour M. Beaumatin" into two odd-sounding TTS chunks. Single
// letters (initials like "J. K.") are handled separately.
const ABBREV = new Set([
  "m", "mm", "mme", "mlle", "mr", "mrs", "ms", "dr", "pr", "prof", "st", "ste", "sgt", "lt", "col", "gen", "capt",
  "etc", "vs", "cf", "al", "ca", "env", "approx", "no", "nos", "art", "vol", "p", "pp", "fig", "ed", "\u00e9d", "r\u00e9f",
  "jr", "sr", "inc", "ltd", "co", "corp", "dept", "univ", "ave", "blvd", "bd", "t\u00e9l", "av",
  "jan", "feb", "f\u00e9v", "mar", "apr", "avr", "jun", "juin", "jul", "juil", "aug", "ao\u00fbt", "sep", "sept", "oct", "nov", "dec", "d\u00e9c",
  "i.e", "e.g", "a.m", "p.m",
]);

const SENT_END = /[.!?\u2026]/;

/** True if the period at `dotIdx` belongs to a known abbreviation or an initial. */
function isAbbrevDot(buf: string, dotIdx: number): boolean {
  let j = dotIdx - 1;
  while (j >= 0 && /[\p{L}.]/u.test(buf[j]!)) j--;
  const word = buf.slice(j + 1, dotIdx);
  if (!word) return false;
  if (word.length === 1) return /\p{Lu}/u.test(word); // an initial like "J." (uppercase), not "14h."
  return ABBREV.has(word.toLowerCase());
}

// Sentence-boundary detection over the streaming buffer. Returns the index to cut
// at (everything before it is one or more complete sentences), or 0 to wait for
// more text. Cuts only at confident boundaries \u2014 a sentence terminator followed by
// whitespace, skipping abbreviations / initials / decimals (the terminator must be
// followed by space, so "3.14" never splits) \u2014 or at a line break. When `atEnd` is
// set (the turn finished) it flushes whatever is left. This keeps every TTS chunk a
// natural utterance, so the voice never pauses mid-clause.
function nextSentenceCut(buf: string, atEnd: boolean): number {
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i]!;
    if (ch === "\n") {
      let k = i + 1;
      while (k < buf.length && /[ \t\n]/.test(buf[k]!)) k++;
      return k;
    }
    if (!SENT_END.test(ch)) continue;
    let end = i;
    while (end + 1 < buf.length && SENT_END.test(buf[end + 1]!)) end++; // "?!", "..."
    const after = buf[end + 1];
    if (after === undefined) return atEnd ? buf.length : 0; // need the next char to judge
    if (!/\s/u.test(after)) {
      i = end;
      continue;
    } // e.g. "U.S.A" mid-token, "3.14"
    if (ch === ".") {
      if (isAbbrevDot(buf, i)) {
        i = end;
        continue;
      }
      // Unknown abbreviation guard: a real sentence starts with a capital / digit /
      // opening quote / emoji. If the next token starts lowercase, assume it's still
      // the same sentence and keep going (prefer a long chunk over a mid-clause cut).
      let k = end + 1;
      while (k < buf.length && /\s/u.test(buf[k]!)) k++;
      if (k >= buf.length) return atEnd ? buf.length : 0;
      const nx = buf.slice(k, k + 2);
      const startsNew = /^[\p{Lu}\p{N}"'\u00ab(\u00a1\u00bf\[]/u.test(nx) || EMOJI_RE.test(nx);
      EMOJI_RE.lastIndex = 0;
      if (!startsNew) {
        i = end;
        continue;
      }
    }
    let k = end + 1;
    while (k < buf.length && /[ \t]/.test(buf[k]!)) k++;
    k = absorbTrailingEmojis(buf, k); // keep "Great! 🎉" together, not "🎉 Next"
    // If that ran to the buffer's end mid-stream, wait: a trailing emoji may still
    // be streaming in, and we want it on THIS sentence rather than the next chunk.
    if (k >= buf.length) return atEnd ? buf.length : 0;
    return k;
  }
  return atEnd && buf.trim() ? buf.length : 0;
}

/** Each emoji in a (markdown-stripped) chunk with its fractional position among the
 *  SPOKEN characters, so the avatar can morph to it roughly when the voice reaches
 *  that point. Position is measured before the emoji is stripped from the audio. */
function emojiTimeline(md: string): Array<{ glyph: string; frac: number }> {
  const spokenTotal = md.replace(EMOJI_STRIP_RE, "").length || 1;
  const out: Array<{ glyph: string; frac: number }> = [];
  EMOJI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_RE.exec(md)) !== null) {
    const before = md.slice(0, m.index).replace(EMOJI_STRIP_RE, "").length;
    out.push({ glyph: m[0], frac: Math.min(1, before / spokenTotal) });
  }
  return out;
}

// Adjacent emojis (e.g. "🌞🌸") share a position because no spoken character sits
// between them, so they'd morph in the same frame and only the last would show.
// Pull each one back so consecutive emojis keep a minimum spacing, anchored at and
// leading up to where they sit — each then gets its own on-screen moment.
const EMOJI_FRAC_GAP = 0.18;
function spreadEmojiFracs(list: Array<{ glyph: string; frac: number }>): void {
  for (let i = list.length - 2; i >= 0; i--) {
    const ceiling = list[i + 1]!.frac - EMOJI_FRAC_GAP;
    if (list[i]!.frac > ceiling) list[i]!.frac = Math.max(0, ceiling);
  }
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
  /** 0..1 progress through the current spoken line, for scrolling the subtitle. */
  onCaptionScroll?: (progress: number) => void;
  onToolLabel: (label: string | null) => void;
  onError?: (msg: string) => void;
}

interface TtsChunk {
  speak: string; // markdown- and emoji-stripped text sent to the TTS
  caption: string; // synced subtitle (same clean text — no markdown, no emoji)
  emojis: Array<{ glyph: string; frac: number }>; // emoji morphs, by playback fraction
  tone?: string; // voice-tone instruction (promptable TTS)
}

/** Sequential TTS player with an analyser for the avatar's "speaking" reaction.
 *  Reports the spoken chunk's caption on start, so subtitles track the audio, and
 *  exposes the playing chunk + progress so the loop can fire each emoji morph when
 *  the voice reaches its position in the sentence. */
class TtsPlayer {
  readonly analyser: AnalyserNode;
  private audio = new Audio();
  private ctx = new AudioContext();
  // Each item's audio starts generating the moment it is enqueued (prefetch), so
  // generation is pipelined with playback and there is no gap between chunks.
  private queue: Array<{ chunk: TtsChunk; url: Promise<string | null> }> = [];
  private playing = false;
  current: TtsChunk | null = null; // the chunk currently playing (for emoji timing)

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

  /** Playback progress of the current chunk, 0..1 (0 if nothing is playing). */
  progress(): number {
    const d = this.audio.duration;
    if (!this.playing || !isFinite(d) || d <= 0) return 0;
    return Math.min(1, Math.max(0, this.audio.currentTime / d));
  }

  enqueue(chunk: TtsChunk): void {
    this.queue.push({ chunk, url: this.fetchUrl(chunk) });
    if (!this.playing) void this.next();
  }

  private async fetchUrl(chunk: TtsChunk): Promise<string | null> {
    try {
      const { blobId } = await api.speech(chunk.speak, chunk.tone);
      return api.blobs.url(blobId);
    } catch {
      return null;
    }
  }

  private async next(): Promise<void> {
    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      this.current = null;
      this.onEnd();
      return;
    }
    this.playing = true;
    const url = await item.url; // generation was kicked off at enqueue time
    if (!url) {
      void this.next();
      return;
    }
    this.audio.src = url;
    this.current = item.chunk;
    this.onStart(item.chunk);
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
    this.current = null;
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
  private replyText = ""; // the whole reply so far (never sliced) for the mood scan
  private pendingEmojis: string[] = []; // emojis from silent gaps, ride the next spoken chunk
  private firedIdx = 0; // how many of the current chunk's emojis have morphed
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private toolCycleTimer: ReturnType<typeof setInterval> | null = null;
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
        this.firedIdx = 0; // restart this chunk's emoji timeline
        this.setState("speaking");
        this.cb.onCaption(chunk.caption); // subtitle tracks the spoken chunk
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
      this.pendingEmojis = [];
    }
    // Clear any lingering emoji morph (e.g. the reply's last one still dissolving).
    if (this.morphTimer) {
      clearTimeout(this.morphTimer);
      this.morphTimer = null;
    }
    if (!this.presenting) this.avatar.set({ morph: null });
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
      this.pendingEmojis = [];
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
      this.pumpSpeech(true); // flush whatever's left as final sentence(s)
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
      this.pumpSpeech(false);
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

  /** Flush every complete sentence from the buffer into the TTS queue. `atEnd`
   *  (turn finished) flushes the remainder too. Each chunk is markdown- and
   *  emoji-stripped for both the audio and the caption; its emojis are kept as a
   *  playback-fraction timeline so the avatar morphs to them in step with the voice. */
  private pumpSpeech(atEnd: boolean): void {
    for (;;) {
      const cut = nextSentenceCut(this.assistantBuf, atEnd);
      if (cut <= 0) break;
      const raw = this.assistantBuf.slice(0, cut);
      this.assistantBuf = this.assistantBuf.slice(cut);
      this.enqueueChunk(raw);
    }
  }

  private enqueueChunk(raw: string): void {
    const md = stripMarkdown(raw); // markdown gone, emojis still in (for positioning)
    const timeline = emojiTimeline(md);
    const speak = stripEmoji(md);
    if (!/[\p{L}\p{N}]/u.test(speak)) {
      // No speakable text (e.g. an emoji-only line): carry its emojis to the next
      // spoken chunk so they still show, riding its start.
      for (const e of timeline) this.pendingEmojis.push(e.glyph);
      return;
    }
    const emojis = [...this.pendingEmojis.map((glyph) => ({ glyph, frac: 0 })), ...timeline];
    this.pendingEmojis = [];
    spreadEmojiFracs(emojis); // give consecutive emojis distinct moments
    this.tts.enqueue({ speak, caption: speak, emojis, tone: toneFor(this.lastEmotion || "neutral") });
  }

  /** Morph the avatar to each of the current chunk's emojis as the voice reaches
   *  its position (driven by audio playback progress, 0..1). */
  private fireEmojis(progress: number): void {
    const cur = this.tts.current;
    if (!cur) return;
    while (this.firedIdx < cur.emojis.length && progress >= cur.emojis[this.firedIdx]!.frac) {
      const e = cur.emojis[this.firedIdx++]!;
      if (!this.presenting && !this.toolCycleTimer) this.transientMorph(emojiTarget(e.glyph, 12000), 1500);
    }
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
      // Soft return: go back to listening but leave any in-flight emoji morph to
      // dissolve on its own timer, so the reply's final emoji is still visible for
      // a beat (a hard clearMorph would snap it away the instant it fired).
      this.stopToolCycle();
      this.cb.onToolLabel(null);
      this.setState(this.vad ? "listening" : "idle");
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
      const p = this.tts.progress();
      this.cb.onCaptionScroll?.(p); // scroll the subtitle with the audio
      this.fireEmojis(p); // morph to each emoji as the voice reaches it
    } else if ((this.state === "listening" || this.state === "idle") && this.micAnalyser) {
      level = rmsOf(this.micAnalyser, this.micBuf) * 4;
      bands = bandsOf(this.micAnalyser, this.micFreq);
    }
    this.avatar.set({ level: Math.min(1, level), bands, state: this.state });
  }
}
