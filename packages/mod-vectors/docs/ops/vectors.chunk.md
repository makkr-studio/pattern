Split text for indexing without a tokenizer dependency: a recursive character
splitter that prefers paragraph breaks, then line breaks, then sentence ends,
merges neighbors up to `maxChars` (default 1200) and carries `overlap`
characters (default 150) across chunk boundaries so answers spanning a cut
survive retrieval. Wire `text` (one string) or `docs`
(`[{ id?, text, meta? }]`); chunks come back as `[{ id, text, meta? }]` with
ids `${docId}#${i}` and the doc's meta on every chunk. Usually you want
`vectors.index`, which chunks and writes in one node.
