Pass `value` through when `when` is true, otherwise emit `undefined`. Inside a
`core.stream.each` region this **drops the chunk** (collect ignores `undefined`),
so it's the no-branch way to skip/filter per chunk: compute a boolean with
`core.cmp.*` / `core.bool.*`, feed it to `when`, and the chunk is kept or dropped,
all at the value level, with no control-flow op and no sub-run.
