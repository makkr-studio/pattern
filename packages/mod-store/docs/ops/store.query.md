Query a collection with equality filters on DECLARED indexed fields (plus
orderBy/limit/offset). If you need a new filterable field, add it to the
collection's `indexes` — `ensureCollection` backfills existing docs. This is
a deliberate constraint: no accidental full scans.
