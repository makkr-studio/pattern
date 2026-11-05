One collection's documents for the admin Data browser, at
`GET /admin/api/store/collections/:collection/docs`, newest `updatedAt`
first. Each row is `{ id, collection, version, updated, preview }`, where
`preview` is the first 120 characters of the JSON data. `limit` (default 100,
capped at 500) and `offset` page through it; the shipped route wires only
`collection`, so it shows the first 100. Use `store.query` in your own
workflows: it filters on indexed fields and returns full rows. For one full
document use `store.admin.doc.get`. Privileged: gate the trigger with the
`admin` scope.
