Transform each chunk through the referenced sub-workflow — streaming, with
backpressure, one linked sub-run per chunk. For token streams prefer cheap
inline transforms downstream; sub-runs per token are visible but not free.
