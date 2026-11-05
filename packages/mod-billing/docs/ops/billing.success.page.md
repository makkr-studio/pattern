Render the checkout landing page. The provider redirects here the moment
payment settles — usually before the completion webhook has done its work — so
this page absorbs the race honestly: it thanks the buyer and polls
`billing.status.mine` (at the configured `statusPath`) until the unlock lands,
then forwards to `next`. For a subscription that means `entitled` flipping; for
a one-time purchase, the `item` the checkout put on the return URL appearing in
`purchased`. Already unlocked → an immediate redirect, no flash of "unlocking".
Not signed in → a static thank-you with a Continue link (there is no one to
poll for). `next` is guarded to a relative path — absolute URLs collapse to `/`,
so the page can never be an open redirect; `item` is guarded to a plain price
key. Backs the seeded `GET /billing/success` route; not meant for canvas reuse.
