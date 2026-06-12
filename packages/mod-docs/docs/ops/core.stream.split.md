Tees one stream to N consumers (`branches` in config → `out.0..n`). Each
branch gets its own backpressured copy: a slow consumer slows the source
rather than buffering unboundedly. This is how one agent token stream feeds
both an SSE response and a persistence sink.
