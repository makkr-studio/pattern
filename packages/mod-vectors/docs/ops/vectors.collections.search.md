The admin's try-a-query op (behind Data → Vectors → **Search**): top-k scored
matches from a collection, hybrid by default (vector + keyword, RRF-fused),
with each match's text (truncated) and meta. This is the smoke test for what
an ingest actually indexed — paste in one section, search in the next, read
the scores. For canvas/workflow retrieval use `vectors.query` (config-driven,
filterable); this op exists so the admin form can pass the collection as an
input. Privileged: gate the trigger with the `admin` scope.
