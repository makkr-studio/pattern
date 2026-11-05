Embed a list of strings (`values`) in one node; `embeddings[i]` is the vector
for `values[i]`. Use it for batch work: indexing a set of documents, embedding
the chunks from `vectors.chunk`, or comparing a list of labels against a query.

The AI SDK splits large lists into provider-sized batches; config
`maxParallelCalls` caps how many batches run at once (useful against rate
limits). Wire the same embedding model you will query with. For one string,
`ai.embed` is simpler; for a full index-and-search pipeline, `vectors.index`
handles chunking, embedding and storage together.
