/**
 * WebAudio analysis helpers shared by the composer's mic meter and the voice
 * avatar (mic "listening" reaction + TTS-driven bloom). Thin wrappers over
 * AnalyserNode so callers don't repeat the boilerplate.
 */

/** An analyser tapping a live mic (or any) stream. */
export function analyserFromStream(ctx: AudioContext, stream: MediaStream, fftSize = 1024): AnalyserNode {
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = fftSize;
  an.smoothingTimeConstant = 0.8;
  src.connect(an);
  return an;
}

/**
 * An analyser on a media element (TTS playback), kept audible by also routing to
 * the destination. The element can only be sourced once — callers cache it.
 */
export function analyserFromElement(ctx: AudioContext, el: HTMLMediaElement, fftSize = 1024): AnalyserNode {
  const src = ctx.createMediaElementSource(el);
  const an = ctx.createAnalyser();
  an.fftSize = fftSize;
  an.smoothingTimeConstant = 0.82;
  src.connect(an);
  an.connect(ctx.destination);
  return an;
}

/** Root-mean-square level (0..~1) from an analyser's time-domain data. */
export function rmsOf(an: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
}

/** Coarse frequency bands (bass, mid, treble) in 0..1, from FFT magnitudes. */
export function bandsOf(an: AnalyserNode, buf: Uint8Array<ArrayBuffer>): { bass: number; mid: number; treble: number } {
  an.getByteFrequencyData(buf);
  const n = buf.length;
  const avg = (a: number, b: number) => {
    let s = 0;
    const lo = Math.max(0, Math.floor(a * n));
    const hi = Math.min(n, Math.floor(b * n));
    for (let i = lo; i < hi; i++) s += buf[i] ?? 0;
    return hi > lo ? s / (hi - lo) / 255 : 0;
  };
  return { bass: avg(0, 0.08), mid: avg(0.08, 0.4), treble: avg(0.4, 1) };
}
