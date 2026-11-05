Deletes one document from the admin Data browser, at
`DELETE /admin/api/store/collections/:collection/docs/:id`. Returns `{ ok }`:
true when a row went away, false when there was nothing to delete. Same
effect as `store.delete`, with no CAS and no lease, so a workflow writing the
same id can re-create it right after. Blobs the document referenced stay in
place; remove them with `store.admin.blob.delete`. Privileged: gate the
trigger with the `admin` scope.
