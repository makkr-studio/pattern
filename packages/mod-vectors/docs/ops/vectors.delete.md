Delete rows by id from a collection (vectors, meta index and keyword index
together). Returns `{ count }`. Chunked docs delete by their chunk ids
(`${docId}#${i}`) — list them from a `vectors.query` filtered on the doc's
meta, or re-index the doc instead: unchanged chunks are skipped, changed ones
overwrite in place.
