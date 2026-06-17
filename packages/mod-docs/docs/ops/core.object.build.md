Assembles an object from wired ports: config `keys: ["id", "meta"]` declares
one input port per key; the output is `{ id, meta }`. The inverse of
`core.object.get`.

Use it for a **deliberate** response shape — a projection (rename/pick/merge) or
a body assembled from several ops. Don't use it to rebuild an entity an op
already returns whole: wire that single domain port straight to the response
body instead. Decompose *inputs* to the field; keep *outputs* at domain
granularity (see *Designing your API*).
