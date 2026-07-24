Create a hosted checkout session and output its `url` — wire it into
`boundary.http.response`'s redirect and the provider hosts cards, taxes and
3DS. `userId` becomes the session's reference: the completion webhook uses it
to map the new provider customer back to your user, which is what makes the
entitlement bridge work — always wire the trigger's `user.id` here. `priceKey`
falls back to the account's `defaultPriceKey` option; `mode` is subscription
by default (payment for one-time). Redirect URLs anchor on PATTERN_PUBLIC_URL
(the wired `origin` is the fallback for local dev), and `next` (config or
input, relative-path guarded) rides them as `?next=` so the packaged return
pages forward the buyer back to the gated page this checkout started from.
Retries are provider-side idempotent: the idempotency key is pinned to the
run+node, so a retried attempt replays the same session instead of minting
another.
