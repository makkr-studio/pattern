# Vectors

`@pattern-js/mod-vectors` gives your app **embedding collections**: named
indexes of text (or raw vectors) you can search semantically, by keyword, or
both at once — the retrieval half of RAG, as ordinary ops on the canvas.

```jsonc
{ "mods": ["@pattern-js/mod-ai", "@pattern-js/mod-vectors"] }
```

## Collections declare their model

The classic silent RAG bug is indexing with one embedding model and querying
with another — every score turns to noise and nothing errors. Pattern designs
it out: a collection **declares its embedding alias** at creation
(`vectors.collection.ensure`), every embed — index side and query side — goes
through that alias, and the vector dimensionality **locks on the first
write**. Re-point the alias at a model with different dims and the next write
fails with an error that names the alias and the fix (re-index into a fresh
collection), instead of silently degrading your search.

```
vectors.collection.ensure  { name: "kb", alias: "embeddings", filterables: ["product", "lang"] }
```

Aliases come from mod-ai's Settings page — `@pattern-js/mod-ai` must be
installed for text embedding (raw-vector upsert/query works without it).

## Ingesting: chunk → embed → upsert

`vectors.index` is the one-node ingestion path: give it
`docs: [{ id, text, meta? }]`, it splits each doc (recursive character
splitter — `maxChars` 1200, `overlap` 150, paragraph/sentence separators),
embeds through the collection's alias, and upserts chunks with ids
`${docId}#${i}`, each carrying its doc's meta. `vectors.chunk` and
`vectors.upsert` are the same steps as separate nodes when you want the
pipeline visible.

Writes are **content-hashed**: re-running ingestion over unchanged documents
embeds nothing and writes nothing — only the diff pays. That's what makes
"re-index everything on boot" a cheap, idempotent habit.

## Querying: vector, keyword, hybrid

`vectors.query` takes `text` (embedded via the collection's alias) or a raw
`vector`, and ranks in one of three modes:

- **`vector`** (default) — cosine similarity.
- **`keyword`** — exact-word ranking: FTS5 when your Node's sqlite build has
  it (probed at startup), a zero-dependency token-overlap scorer otherwise.
- **`hybrid`** — both rankings fused with reciprocal-rank fusion (RRF). No
  score calibration, no tuning knob; exact identifiers and paraphrased
  questions both surface.

## Filterable metadata

Real corpora carry structure — products, languages, tenants, doc types.
Declare those meta fields as `filterables` on the collection and they are
extracted into an indexed side table at write time; `vectors.query`'s
`filter: { field: value | values[] }` (AND of equality/any-of) then **prunes
before any scoring touches a vector**. Filtering on an undeclared field is a
located error naming the field and the fix — never a silently empty result.

The pattern for complex structures: keep the canonical record in
**mod-store** (the truth), index its text here with `docId` + taxonomy fields
in meta (the index), and compose `vectors.query → store.doc.get` on the
canvas.

## The local engine, durability, and offload

The default engine is honest brute force over Float32 vectors in
`.pattern-data/vectors.db` (WAL sqlite) — no native extensions, no services,
fine to roughly a hundred thousand vectors. Because the index is a file, it
survives restarts AND stays visible to **offloaded** workflows: a worker's
own service instance opens the same database, where an in-memory index would
be invisible.

Past that scale, the **driver SPI** is the seam: an engine registers
`{ id, ensureCollection, upsert, query, delete }` in its mod's `ready` (the
mod-email driver pattern) and receives `{ filter, mode }` to push down.
`sqlite-vec` is the natural first driver — note it is a NATIVE sqlite
extension (needs `allowExtension` + platform binaries), which is exactly why
it ships as a separate driver package rather than in this zero-dependency
default. pgvector follows the same shape.

## Admin

**Data → Vectors** lists every collection: alias, dims, filterables, row
count, active engine.
