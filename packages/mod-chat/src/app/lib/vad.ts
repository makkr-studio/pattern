/**
 * Smart voice capture: Silero neural VAD (@ricky0123/vad-web) detects the end of
 * speech on-device, so the mic stops itself. Loaded lazily (its ONNX model is
 * fetched on first use) and fails soft — callers fall back to push-to-talk.
 *
 * We own the MediaStream + AudioContext and hand them back, so a caller can tap
 * an AnalyserNode off the same mic for a live waveform / level meter (the
 * composer's recording UI and the voice avatar's "listening" reaction).
 */

import { appBoot } from "./config";

// Assets are vendored under <mount>/vad/ (see vite.config.ts). The path must be
// ABSOLUTE: onnxruntime-web loads its wasm glue with dynamic import(), and a bare
// relative specifier ("vad/…") is rejected by the browser as a module specifier.
const ASSET_BASE = `${appBoot.mount.replace(/\/+$/, "")}/vad/`;

export interface VadController {
  /** Begin listening for speech (onSpeechEnd fires per utterance). */
  start(): void;
  /** Stop listening (mic stays open; resume with start()). */
  pause(): void;
  /** Tear down: stop the VAD, the mic tracks, and the AudioContext. */
  destroy(): void;
  /** The live mic stream (for an AnalyserNode). */
  stream: MediaStream;
  /** The AudioContext the VAD runs on (share it for analysers). */
  audioContext: AudioContext;
}

export interface VadHandlers {
  onSpeechStart?: () => void;
  /** A finished utterance as a 16 kHz mono WAV blob, ready for transcription. */
  onSpeechEnd: (wav: Blob) => void;
  /** Speech started but was too short to count. */
  onMisfire?: () => void;
}

/**
 * Open the mic and start a Silero VAD on it. Returns null (with the error logged
 * to onError) when the model/worklet can't load — the caller should fall back to
 * manual recording.
 */
export async function createVad(handlers: VadHandlers, onError?: (e: unknown) => void): Promise<VadController | null> {
  let stream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  try {
    const { MicVAD, utils } = await import("@ricky0123/vad-web");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioContext = new AudioContext();
    const ctx = audioContext;
    const micStream = stream;

    const vad = await MicVAD.new({
      // Legacy model = silero_vad_legacy.onnx (vendored under ASSET_BASE).
      model: "legacy",
      baseAssetPath: ASSET_BASE,
      onnxWASMBasePath: ASSET_BASE,
      audioContext: ctx,
      getStream: async () => micStream,
      // We own the stream's lifetime (destroy() stops it) so the analyser keeps
      // working between utterances — don't let the VAD stop the tracks on pause.
      pauseStream: async () => {},
      resumeStream: async () => micStream,
      startOnLoad: false,
      onSpeechStart: () => handlers.onSpeechStart?.(),
      onVADMisfire: () => handlers.onMisfire?.(),
      onSpeechEnd: (audio: Float32Array) => {
        const buf = utils.encodeWAV(audio);
        handlers.onSpeechEnd(new Blob([buf], { type: "audio/wav" }));
      },
    });

    let destroyed = false;
    return {
      start: () => void vad.start(),
      pause: () => void vad.pause(),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        void vad.destroy();
        micStream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
      },
      stream: micStream,
      audioContext: ctx,
    };
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    void audioContext?.close().catch(() => {});
    onError?.(e);
    return null;
  }
}
