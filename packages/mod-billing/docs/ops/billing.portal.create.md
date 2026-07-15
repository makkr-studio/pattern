Create a customer-portal session for `userId`'s provider customer and output
its `url` — the provider's own UI for plan changes, cancellation, invoices and
payment methods, so you never build billing screens. Requires an existing
customer (a completed checkout); it throws a located error otherwise. The
return link anchors on PATTERN_PUBLIC_URL + the mod's `portalReturnPath`.
