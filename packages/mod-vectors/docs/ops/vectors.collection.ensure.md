Declare an embedding collection — idempotent, so it belongs at the head of
ingestion workflows. The declaration IS the safety: `alias` names the one
embedding model this collection indexes and queries with, `dims` locks on the
first write (a later mismatch errors naming the alias), and `filterables`
lists the meta fields extracted into the indexed side table — the only fields
`vectors.query` may filter on. Re-declaring updates alias/filterables; dims
never silently change.
