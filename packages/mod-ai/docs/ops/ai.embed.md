Turn one string (`value`) into a vector (`embedding`, an array of numbers), with
`usage` beside it. Use it to embed a search query or a single record when you
manage vectors yourself; for indexing and searching collections, `vectors.index`
and `vectors.query` embed for you through the collection's alias.

Wire an embedding model, for example `ai.model` with `modelId:
"text-embedding-3-small"` on `openai`, or an alias pointed at one. Vectors from
different models live in different spaces, so query with the same model you
indexed with. Embedding calls report `usage` on the port; the `ai.usage` bus
event covers language-model calls only. For many strings at once use
`ai.embed.many`.
