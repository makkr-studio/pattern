Assembles an object from wired ports: config `keys: ["id", "meta"]` declares
one input port per key; the output is `{ id, meta }`. The inverse of
`core.object.get`. Use it to shape API response bodies without writing an op.
