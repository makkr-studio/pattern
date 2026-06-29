Reads a path from an object (`path: "content-type"` or dotted `a.b.c`).
Undefined when missing. Pair with `core.cast.coalesce` for defaults.

This is the per-field extractor for HTTP routes: one node per field, pulling a
value out of `request.body` / `request.params` into its own op port, so the
request→op mapping is a set of visible, rewireable edges (see *Designing your API*).
