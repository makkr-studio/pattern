One document as its full stored row (`id`, `collection`, `data`, `version`
and timestamps), at `GET /admin/api/store/collections/:collection/docs/:id`.
Backs the Data browser's detail view. A miss answers `404` with
`{ error: "not found" }`. Workflows should read with `store.get`, which has the same lookup
and a `found` port to branch on. Privileged: gate the trigger with the `admin`
scope. Delete it with `store.admin.doc.delete`.
