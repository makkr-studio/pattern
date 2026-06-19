Close a **per-chunk region** opened by `core.stream.each`: take each chunk's
processed `value` and re-emit them as a stream. A chunk whose `value` is
`undefined` is dropped, so returning `undefined` from the region filters the
stream. Pairs one-to-one with an upstream `core.stream.each`; everything between
them runs once per chunk, inline in the same run (no sub-run).
