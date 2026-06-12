Store bytes (a value or a stream) with a mime type; get an id + meta back.
Serve them via the shipped `GET /store/blobs/:id` workflow (chunked). The
chat app's image input is exactly this op behind `POST /chat/api/blobs`.
