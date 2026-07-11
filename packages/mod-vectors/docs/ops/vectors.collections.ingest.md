The admin's paste-to-RAG op (behind Data → Vectors → **Ingest text**): chunk a
pasted text, embed it through the collection's declared alias, and upsert —
creating the collection (with the given `alias`, default `embeddings`) when it
doesn't exist yet. An EXISTING collection keeps its declared alias; the input
is ignored on purpose (re-pointing a live collection's embedding model would
corrupt its space). Without a `docId` the id derives from the text content, so
re-pasting the same document is a no-op (content-hash dedupe) and pasting an
edited version re-indexes only the changed chunks. `meta` (a JSON object) is
stamped on every chunk — filterable when the collection declares the field.
Privileged: gate the trigger with the `admin` scope.
