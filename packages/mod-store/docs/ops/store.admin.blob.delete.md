Deletes one blob's bytes and metadata from the admin Data browser, at
`DELETE /admin/api/store/blobs/:id`. Returns `{ ok }`: true when something
was removed, false on a miss. Same effect as `store.blob.delete`. Nothing
checks whether a document still references the blob, so a record pointing
at it gets `found: false` (and a 404 status) from `store.blob.get`
afterwards. Privileged: gate the trigger with the `admin` scope. Find candidates with `store.admin.blobs`.
