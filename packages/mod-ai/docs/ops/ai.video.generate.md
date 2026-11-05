Generate video from a `prompt`. `video` is the first clip and `videos` the full
list (config `n`, default 1), each raw media `{ bytes, mime, kind: "video" }`;
persist with `store.blob.put` as with images. Config `durationSeconds` and
`aspectRatio` pass through to the provider. For image-to-video, wire a start
frame as a MediaRef on `image` (the `ref` from `store.blob.put`); the prompt
then describes the motion. Models without image input reject the call.

Video generation routinely takes minutes. `progress` emits `start` immediately
and `done` when the clips are ready, the call honors editor Stop and run
cancel, and gateway calls run with a 15-minute fetch timeout so they outlast
the default HTTP limit. Run it from a background workflow (`boundary.event` or
`boundary.schedule`) and notify when done; holding an HTTP request open for
minutes rarely ends well.

The op is gateway-first: gateway routing is the main path, and direct
providers work when their package exposes video models. Wire a video model
(`modality: "video"`).
