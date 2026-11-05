The raw setup snapshot behind the billing checklist, served at
`GET /admin/api/billing/api/status`. It reads the `default` account (else the
first one) and its driver and reports: the installed `drivers`, the
`account` with its `missingSecrets` (required driver secret fields that have
no ref), `hasWebhookSecret` and `defaultPriceKey`, the `webhookUrl` to give
the provider, whether `PATTERN_PUBLIC_URL` is set (`publicUrlSet`), and the
`kind` and `at` of the last ingested event, or `null`.

Use it when you want the facts to build your own view or alert on; for the
ready-to-render steps with their next-action copy use `billing.admin.checklist`,
which computes from the same snapshot. Without `PATTERN_PUBLIC_URL` the
`webhookUrl` falls back to `http://localhost:3000`. Privileged: the route
carries the `admin` scope.
