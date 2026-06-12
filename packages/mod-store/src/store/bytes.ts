/** Buffer a byte stream into one Uint8Array, failing fast past `maxBytes`. */
export async function bufferStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = typeof value === "string" ? new TextEncoder().encode(value) : value;
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error(`store: blob exceeds the ${maxBytes}-byte cap`);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
