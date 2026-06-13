Ends a hook handler: the (possibly transformed) `payload` continues down the
chain; `stop: true` short-circuits the remaining handlers (veto semantics).
Forgetting this node means your handler contributes nothing — the chain
threads through the RETURNED payload, not side effects.
