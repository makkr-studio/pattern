Create a customer-portal session for `userId`'s provider customer and output
its `url` — the provider's own UI for cancellation, invoices and payment
methods (plan changes too, once the provider's portal settings allow them), so
you never build billing screens. Needs an existing customer (a completed
checkout); before one exists, `result` carries a friendly conflict outcome for
`boundary.http.status` (subscribe first) instead of failing the run. The
return link anchors on PATTERN_PUBLIC_URL + the mod's `portalReturnPath`.
