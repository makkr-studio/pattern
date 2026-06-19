Render a string for each chunk from `{{ dot.path }}` placeholders evaluated over
that chunk, and re-emit as a stream — no sub-workflow. Objects interpolate to
JSON, missing paths to `""`. Use it to format object chunks (e.g. agent deltas)
into display text before a `boundary.cli.exit` `stdoutStream` or an SSE response.
The streaming sibling of `core.string.template`.
