Ends a hook handler: the (possibly transformed) `payload` continues down the
chain; `stop: true` short-circuits the remaining handlers (veto semantics).
Forgetting this node means your handler contributes nothing. The chain
advances the RETURNED `payload`; a handler that transforms without returning
has no effect on it.
