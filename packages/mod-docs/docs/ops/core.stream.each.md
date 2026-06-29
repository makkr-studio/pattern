Open a **per-chunk region**. Wire value ops between this and `core.stream.collect`
on the canvas; the engine runs that region **once per chunk, inline, in the same
run** (extra spans, but **no sub-run and no new Runs entry**). Outputs the current `item` and its `index`;
values pulled in from outside the region are captured once and threaded into
every iteration. Members must be plain value ops (no streams, branches, or
sub-run ops; this is the no-sub-run boundary). In Replay the region nodes pulse
once per chunk.
