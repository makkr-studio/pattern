/**
 * @pattern-js/mod-vectors — the text chunker.
 *
 * A recursive character splitter (no tokenizer dependency): split on the
 * coarsest separator that still yields pieces under `maxChars`, recurse into
 * oversized pieces with the next separator, then re-join neighbors greedily
 * and carry `overlap` characters of context across chunk boundaries.
 */

export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
  separators?: string[];
}

export interface Chunk {
  /** `${docId}#${i}` when a doc id is known, else `#${i}`. */
  id: string;
  text: string;
  meta?: Record<string, unknown>;
}

const DEFAULTS = { maxChars: 1200, overlap: 150, separators: ["\n\n", "\n", ". "] };

/** Split `text` recursively so every piece fits in maxChars. */
function split(text: string, maxChars: number, separators: string[]): string[] {
  if (text.length <= maxChars) return text.trim() ? [text] : [];
  const [sep, ...rest] = separators;
  if (!sep) {
    // Out of separators — hard-cut (pathological input: one giant unbroken run).
    const out: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
    return out;
  }
  const parts = text.split(sep);
  if (parts.length === 1) return split(text, maxChars, rest);
  const out: string[] = [];
  for (const part of parts) {
    const piece = part.trim() ? part + (sep === ". " ? "." : "") : "";
    if (!piece) continue;
    out.push(...(piece.length > maxChars ? split(piece, maxChars, rest) : [piece]));
  }
  return out;
}

/** Greedily merge neighbor pieces up to maxChars, threading `overlap` chars across boundaries. */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const { maxChars, overlap, separators } = { ...DEFAULTS, ...opts };
  if (maxChars <= 0) throw new Error("vectors.chunk: maxChars must be positive");
  if (overlap >= maxChars) throw new Error("vectors.chunk: overlap must be smaller than maxChars");

  const pieces = split(text, maxChars, separators);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    // Overlap: seed the next chunk with the tail of the previous one.
    const tail = overlap > 0 && current ? current.slice(-overlap) : "";
    current = tail ? `${tail}\n${piece}` : piece;
    // The seeded piece may itself overflow (tail + long piece) — flush the tail alone.
    if (current.length > maxChars) {
      if (tail) chunks.push(tail);
      current = piece;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** Chunk one document into id-stamped chunks carrying the doc's meta. */
export function chunkDoc(
  doc: { id?: string; text: string; meta?: Record<string, unknown> },
  opts: ChunkOptions = {},
): Chunk[] {
  return chunkText(doc.text, opts).map((text, i) => ({
    id: `${doc.id ?? ""}#${i}`,
    text,
    ...(doc.meta ? { meta: doc.meta } : {}),
  }));
}
