Generate images from a `prompt`. `image` is the first result and `images` the
full list (config `n`, default 1); each is raw media `{ bytes, mime, kind }`
held in memory. The op saves nothing: wire `image` into `store.blob.put`'s
`data` and use its `ref` output (a MediaRef served at `GET /store/blobs/:id`)
from there on.

Config `size`, `aspectRatio` and `seed` pass through to the provider, which
honors the ones it supports. For image-to-image or editing, wire a MediaRef on
`image` or a list on `images`: the op reads the bytes from mod-store and
forwards them in the provider's options, which works on providers that accept
image input and is ignored by the rest. Add more provider-specific settings in
config `providerOptions`, keyed by provider id.

`progress` is a stream that emits `start` at once and `done` when the images
are ready, so a UI can show a spinner. The call honors editor Stop and run
cancel. Wire an image model (`modality: "image"`), for example `gpt-image-2` on
`openai`.
