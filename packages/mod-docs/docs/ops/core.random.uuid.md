Mint a fresh UUID v4 for a request id, idempotency key, or record id. Non-deterministic, so each run (and replay) yields a new value. Don't rely on it as a stable key across runs.
