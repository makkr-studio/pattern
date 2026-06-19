Transform each chunk through the referenced sub-workflow — streaming, with
backpressure, one linked sub-run per chunk. For simple per-chunk work (extract a
field, format a string) prefer the no-sub-workflow `core.stream.pluck` and
`core.stream.template`; a sub-run per token is visible but not free. Reach for
`map` when a chunk needs real logic (multiple ops, branching).
