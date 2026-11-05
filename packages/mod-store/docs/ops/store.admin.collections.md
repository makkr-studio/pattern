The collection list for the admin Data browser, at
`GET /admin/api/store/collections`: one row per collection with `name`, its
declared `indexes` joined into a comma string, and a `docs` count. Rows are
sorted by name. Only collections declared through `ensureCollection` appear;
documents written with `store.put` into an undeclared collection are stored
but not listed here. Pure and privileged: the route carries the `admin`
scope, and any trigger you wire it to needs the same gate. Drill into one
with `store.admin.docs`.
