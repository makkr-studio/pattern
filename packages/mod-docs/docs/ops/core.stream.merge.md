Merge N input streams (`in.0..n`) into one: `interleave` (arrival order) or
`concat` (drain each in turn) per config. Fan several producers into a
single consumer, e.g. parallel tool-progress streams into one SSE response.
