Assembles an object from wired ports: config `keys: ["id", "meta"]` declares
one input port per key; the output is `{ id, meta }`. The inverse of
`core.object.get`.

Use it for a **deliberate** response shape: a projection (rename/pick/merge) or
a body assembled from several ops. When an op already returns the entity whole,
wire its output directly to the response body. Decompose *inputs* to the field;
keep *outputs* at domain granularity (see *Designing your API*).
