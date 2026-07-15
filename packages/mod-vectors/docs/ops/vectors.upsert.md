Write items into a collection. Each item is `{ id?, text, meta? }` (the text
embeds through the collection's declared alias — mod-ai must be installed) or
`{ id, vector, meta? }` (raw vectors skip embedding entirely). Declared
filterable meta fields are extracted into the indexed side table at write
time. Writes are content-hashed: items whose id + content match what's stored
are skipped — no embedding call, no write — so re-running ingestion is cheap
and idempotent. Returns `{ count, embedded }` (rows written / texts actually
embedded).
