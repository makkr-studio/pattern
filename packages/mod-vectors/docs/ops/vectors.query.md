Search a collection: wire `text` (embedded via the collection's declared
alias) or a raw `vector`, get `{ matches: [{ id, score, text, meta }] }`.

`mode` picks the ranking: `vector` (cosine, the default), `keyword`
(FTS5 when available, token-overlap otherwise — best for exact identifiers),
or `hybrid` (both, fused with reciprocal-rank fusion — the safe default when
queries mix names and natural language).

`filter: { field: value | values[] }` is an AND of equality/any-of over the
collection's DECLARED filterables, pruned through the indexed side table
BEFORE any scoring — filtering on an undeclared field is a located error, not
an empty result. Compose `vectors.query → store.doc.get` when the canonical
record lives in mod-store.
