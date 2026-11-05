Record a metered-usage event: `value` units on `meter` (the provider meter's
event name) against the user's billing customer — or an explicit `customerId`.
Invoices aggregate the meter automatically at period end. Pass a stable
`identifier` (a runId works) and provider-side dedup makes retries safe —
which is exactly what you want inside a `durable: true` workflow. Wired after
mod-ai's `ai.usage` event, this is how agent tokens become a line item.
