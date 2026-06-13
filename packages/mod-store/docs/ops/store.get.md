Read one document by id → `data`, `found` (false + null data when missing),
and `version` (feed it back into `store.put`/`store.patch` for a CAS write).
Always branch on `found`; don't assume the doc exists.
