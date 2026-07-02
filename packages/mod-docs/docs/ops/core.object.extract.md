The inverse of `core.object.build`: takes one `object` in and emits **one output
port per key** in `config.keys` (the editor adds a port as you add a key).
Missing keys output `undefined`.

This is the ergonomic way to **decompose a request into discrete op inputs**:
point it at `boundary.http.request`'s `body` (or `params`/`query`), list the
fields, and wire each output port straight into a pure domain op's input. One
node covers all fields, saving a `core.object.get` per field. Keep the op
HTTP-free and let the workflow do the shaping (see *Designing your API*).
