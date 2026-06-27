/** @pattern-js/mod-ai — image / speech / transcription / video ops (bytes → MediaRef). */

import { required, stream, value, z, type OpDefinition } from "@pattern-js/core";
import { modelRefSchema } from "@pattern-js/mod-agents";
import { generateImage, generateSpeech, generateVideo, transcribe } from "../sdk.js";
import { genProgressSchema, mediaRefSchema, mediaSchema, segmentSchema, type GenProgress, type Media, type MediaRef } from "../types.js";
import { maybe, mediaBytes, providerService } from "./shared.js";

/** Emit start → (await the work) → done. A thin progress channel for long jobs. */
function progressStream(work: Promise<unknown>): ReadableStream<GenProgress> {
  return new ReadableStream<GenProgress>({
    async start(controller) {
      controller.enqueue({ phase: "start" });
      try {
        await work;
      } finally {
        controller.enqueue({ phase: "done" });
        controller.close();
      }
    },
  });
}

/** Resolve input image MediaRefs to base64 data URLs (for providers that accept image input). */
async function imageDataUrls(ctx: Parameters<typeof mediaBytes>[0], refs: MediaRef[]): Promise<string[]> {
  return Promise.all(
    refs.map(async (r) => {
      const bytes = await mediaBytes(ctx, r);
      return `data:${r.mime || "image/png"};base64,${Buffer.from(bytes).toString("base64")}`;
    }),
  );
}

export const imageGenerate: OpDefinition = {
  type: "ai.image.generate",
  title: "ai.image.generate",
  description:
    "Generate image(s) from a prompt. Optionally pass input image(s) for image-to-image / editing — this is provider-dependent " +
    "(forwarded via providerOptions; honored by providers that accept image input, ignored otherwise). Outputs raw media (bytes + mime); " +
    "wire it into store.blob.put to persist it (yielding a MediaRef).",
  config: z.object({
    n: z.number().int().positive().default(1),
    size: z.string().optional(),
    aspectRatio: z.string().optional(),
    seed: z.number().int().optional(),
    /** Pass-through provider options (merged with any forwarded input images). */
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  }),
  inputs: {
    model: required(modelRefSchema),
    prompt: required(z.string()),
    /** Optional input image(s) for image-to-image / editing (provider-dependent). */
    image: value(mediaRefSchema),
    images: value(z.array(mediaRefSchema)),
  },
  outputs: {
    image: value(mediaSchema),
    images: value(z.array(mediaSchema)),
    progress: stream(genProgressSchema),
  },
  execute: async (ctx) => {
    const [modelRefRaw, prompt, oneImage, manyImages] = await Promise.all([
      ctx.input.value("model"),
      ctx.input.value<string>("prompt"),
      maybe<MediaRef>(ctx, "image"),
      maybe<MediaRef[]>(ctx, "images"),
    ]);
    const modelRef = modelRefSchema.parse(modelRefRaw);
    const model = await providerService(ctx).imageModel(modelRef, ctx);
    const cfg = ctx.config as { n: number; size?: string; aspectRatio?: string; seed?: number; providerOptions?: Record<string, Record<string, unknown>> };

    // Forward any input images under the underlying provider's options key (best-effort, provider-dependent).
    const inputRefs = [...(oneImage ? [oneImage] : []), ...(manyImages ?? [])];
    let providerOptions = cfg.providerOptions ? { ...cfg.providerOptions } : undefined;
    if (inputRefs.length) {
      const urls = await imageDataUrls(ctx, inputRefs);
      const key = modelRef.routing === "gateway" ? modelRef.modelId.split("/")[0] || "gateway" : modelRef.provider;
      providerOptions = { ...(providerOptions ?? {}) };
      providerOptions[key] = { ...(providerOptions[key] ?? {}), image: urls[0], images: urls };
    }

    const media = (async () => {
      const r = await generateImage({
        model,
        prompt,
        n: cfg.n,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        size: cfg.size as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        aspectRatio: cfg.aspectRatio as any,
        seed: cfg.seed,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(providerOptions ? { providerOptions: providerOptions as any } : {}),
        abortSignal: ctx.signal,
      });
      return r.images.map((img): Media => ({ bytes: img.uint8Array, mime: img.mediaType, kind: "image" }));
    })();
    return {
      image: media.then((m) => m[0]),
      images: media,
      progress: progressStream(media),
    };
  },
};

export const speechGenerate: OpDefinition = {
  type: "ai.speech.generate",
  title: "ai.speech.generate",
  description: "Synthesize speech (TTS) from text. Outputs raw audio (bytes + mime); wire it into store.blob.put to persist it (yielding a MediaRef).",
  config: z.object({ voice: z.string().optional(), speed: z.number().optional(), format: z.string().optional() }),
  // `instructions` steers the voice tone/style on providers that support it
  // (e.g. OpenAI gpt-4o-mini-tts: "Speak warmly and excitedly").
  inputs: { model: required(modelRefSchema), text: required(z.string()), instructions: value(z.string()) },
  outputs: { audio: value(mediaSchema) },
  execute: async (ctx) => {
    const [modelRef, text, instructions] = await Promise.all([
      ctx.input.value("model"),
      ctx.input.value<string>("text"),
      maybe<string>(ctx, "instructions"),
    ]);
    const model = await providerService(ctx).speechModel(modelRefSchema.parse(modelRef), ctx);
    const cfg = ctx.config as { voice?: string; speed?: number };
    const r = await generateSpeech({
      model,
      text,
      voice: cfg.voice,
      speed: cfg.speed,
      instructions: instructions && instructions.trim() ? instructions : undefined,
      abortSignal: ctx.signal,
    });
    return { audio: { bytes: r.audio.uint8Array, mime: r.audio.mediaType, kind: "audio" } satisfies Media };
  },
};

export const transcribeOp: OpDefinition = {
  type: "ai.transcribe",
  title: "ai.transcribe",
  description: "Transcribe audio to text (STT). Pass a MediaRef (or raw bytes). Returns text + optional segments.",
  config: z.object({ language: z.string().optional() }),
  inputs: { model: required(modelRefSchema), audio: required(mediaRefSchema), audioBytes: value(z.instanceof(Uint8Array)) },
  outputs: {
    text: value(z.string()),
    segments: value(z.array(segmentSchema)),
    language: value(z.string()),
    durationMs: value(z.number()),
  },
  execute: async (ctx) => {
    const [modelRef, audioRef, audioBytes] = await Promise.all([
      ctx.input.value("model"),
      ctx.input.value<MediaRef>("audio"),
      maybe<Uint8Array>(ctx, "audioBytes"),
    ]);
    const model = await providerService(ctx).transcriptionModel(modelRefSchema.parse(modelRef), ctx);
    const audio = audioBytes ?? (await mediaBytes(ctx, audioRef));
    const r = await transcribe({ model, audio, abortSignal: ctx.signal });
    return {
      text: r.text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      segments: (r.segments ?? []).map((s: any) => ({ text: s.text, startSecond: s.startSecond, endSecond: s.endSecond })),
      language: r.language ?? "",
      durationMs: r.durationInSeconds != null ? Math.round(r.durationInSeconds * 1000) : 0,
    };
  },
};

export const videoGenerate: OpDefinition = {
  type: "ai.video.generate",
  title: "ai.video.generate",
  description:
    "Generate video from a prompt (optionally an image for image-to-video). Long-running (minutes): progress streams start/done. Outputs raw " +
    "media (bytes + mime); wire it into store.blob.put to persist it (yielding a MediaRef). Gateway-first.",
  config: z.object({
    n: z.number().int().positive().default(1),
    durationSeconds: z.number().int().positive().optional(),
    aspectRatio: z.string().optional(),
  }),
  inputs: { model: required(modelRefSchema), prompt: required(z.string()), image: value(mediaRefSchema) },
  outputs: {
    video: value(mediaSchema),
    videos: value(z.array(mediaSchema)),
    progress: stream(genProgressSchema),
  },
  execute: async (ctx) => {
    const [modelRef, prompt] = await Promise.all([ctx.input.value("model"), ctx.input.value<string>("prompt")]);
    const model = await providerService(ctx).videoModel(modelRefSchema.parse(modelRef), ctx);
    const cfg = ctx.config as { n: number; durationSeconds?: number; aspectRatio?: string };
    const media = (async () => {
      const r = await generateVideo({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: model as any,
        prompt,
        n: cfg.n,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(cfg.durationSeconds ? { duration: cfg.durationSeconds } : ({} as any)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        aspectRatio: cfg.aspectRatio as any,
        abortSignal: ctx.signal,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (r.videos as any[]).map((v): Media => ({ bytes: v.uint8Array, mime: v.mediaType ?? "video/mp4", kind: "video" }));
    })();
    return {
      video: media.then((m) => m[0]),
      videos: media,
      progress: progressStream(media),
    };
  },
};

export const mediaOps: OpDefinition[] = [imageGenerate, speechGenerate, transcribeOp, videoGenerate];
