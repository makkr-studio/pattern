The one-node RAG ingestion path: chunk → embed → upsert. Wire
`docs: [{ id, text, meta? }]`; each doc is split (same knobs as
`vectors.chunk`), embedded through the collection's declared alias, and
written as chunks `${docId}#${i}` carrying the doc's meta (so declared
filterables apply to every chunk). Content-hashed like `vectors.upsert`:
unchanged chunks cost nothing on re-runs. Returns `{ count, chunks }` (rows
actually written / chunks produced).
