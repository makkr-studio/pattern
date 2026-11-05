The user's subscription, provider-fresh: `{ status, entitled, priceKeys,
customerId }`. When a subscription exists it asks the provider (falling back
to the local mapping if unreachable); with none it returns the mapping state.
Use this for a billing/account page where freshness matters; for hot-path
gating use `billing.entitled` — it never leaves the process.
