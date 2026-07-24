Render the checkout landing page. The provider redirects here the moment
payment settles — usually before the completion webhook has granted the role —
so this page absorbs the race honestly: it thanks the buyer and polls
`billing.status.mine` (at the configured `statusPath`) until `entitled` flips,
then forwards to `next`. Already entitled → an immediate redirect, no flash of
"unlocking". Not signed in → a static thank-you with a Continue link (there is
no one to poll for). `next` is guarded to a relative path — absolute URLs
collapse to `/`, so the page can never be an open redirect. Backs the seeded
`GET /billing/success` route; not meant for canvas reuse.
