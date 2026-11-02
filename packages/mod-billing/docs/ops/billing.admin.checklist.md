"From zero to your first payment" as data: six steps (driver installed,
account exists, API key connected, a price to sell, webhook secret set, first
event received), each `{ ok, label, how?, detail? }`, plus `done` and an
optional `note` reminding you to set `PATTERN_PUBLIC_URL`. The step copy lives
here once, next to the state it reports on, so the Billing page and the admin
dashboard's getting-started board render the same thing. The mod declares it
as a frontend `checklists` entry pointing at
`GET /admin/api/billing/api/checklist`.

The last step's `detail` names the most recent event and its age (for
example `checkout.completed · 3m ago`), which is how you watch `stripe listen`
deliver its first event. The `how` copy is written for Stripe; another driver
still gets the same steps. For the underlying fields use
`billing.admin.status`. Privileged: the route carries the `admin` scope.
