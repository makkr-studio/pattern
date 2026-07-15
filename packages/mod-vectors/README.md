# @pattern-js/mod-vectors

Vector search for [Pattern](https://github.com/makkr-studio/pattern):
embedding collections that **declare their embedding alias** (so
index-with-one-model-query-with-another is unrepresentable), filterable
metadata pruned before scoring, hybrid vector+keyword retrieval with RRF
fusion, a no-tokenizer text chunker, and a zero-dependency sqlite-backed
local engine — durable and offload-safe — with a driver SPI for sqlite-vec
and pgvector later.

```jsonc
// pattern.config.json
{ "mods": ["@pattern-js/mod-ai", "@pattern-js/mod-vectors"] }
```

Ops: `vectors.collection.ensure`, `vectors.index` (chunk→embed→upsert),
`vectors.chunk`, `vectors.upsert`, `vectors.query` (vector | keyword |
hybrid, `filter: { field: value }`), `vectors.delete`.

Full chapter: your app's `/docs` → **Vectors** (or
[the handbook source](./docs/index.md)).
