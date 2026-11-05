The one-time purchase check: does `userId` own `priceKey`? `{ owns, purchased }`
straight from the local customer mapping the completion webhook maintains —
no provider round-trip, safe on every request. `priceKey` is a lookup key
(`lifetime`) or a `price_…` id, from config or the input; `purchased` lists
everything the user has bought outright. Wire `owns` into `core.flow.branch`
to gate a bought feature mid-graph. For route-level gating, give the price a
`grants` role in the mod options and put `requireAuth` on the scope instead —
then the workflow never mentions billing at all. The subscription-side sibling
is `billing.entitled`.
