Value-level ternary: `cond ? then : else`. `else` is `undefined` when left
unwired (so it also filters — an undefined result drops a chunk in a stream
region). Pure, with no control branch or sub-run, so it's legal inside a
`core.stream.each` region — choose a different value per chunk without leaving
the value world.
