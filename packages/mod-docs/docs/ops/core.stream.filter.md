Keep only the chunks where the referenced sub-workflow returns truthy —
streaming, with backpressure. The predicate gets `{ item, index }` like the
array ops, but never sees the whole stream.
