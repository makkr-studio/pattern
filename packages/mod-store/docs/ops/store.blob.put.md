Save bytes to the blob store and get back an `id`, `meta`, and a ready-to-use
`MediaRef` (`ref`, `{ blobId, mime }`). Accepts a bytes value, a byte stream
(a streamed request body), a data-URL or plain text, or a generation op's media
payload (`ai.image`/`speech`/`video.generate` output `{ bytes, mime, kind }`):
this is the explicit save node those ops leave to the workflow. Serve the result
via the shipped `GET /store/blobs/:id` workflow (chunked); the chat app's image
input is this op behind `POST /chat/api/blobs`.
