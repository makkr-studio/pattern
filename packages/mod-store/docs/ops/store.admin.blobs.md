The stored blobs for the admin Data browser, at `GET /admin/api/store/blobs`,
newest first. Each row is `{ id, mime, size, owner, created }` (`owner` is
the empty string when the blob has no `ownerId`). `limit` defaults to 100 and
is capped at 500; the shipped route does not wire it. This lists metadata
only; fetch the bytes with `store.blob.get`. Useful for spotting orphaned
uploads, since blobs are never garbage-collected. Privileged: gate the
trigger with the `admin` scope.
