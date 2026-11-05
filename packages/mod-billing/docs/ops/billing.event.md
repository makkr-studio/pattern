The billing trigger: fires once per normalized provider event, AFTER
verification, dedup, purchase recording and role projection —
`checkout.completed` (any checkout), `purchase.completed` (a one-time
purchase, with what was bought and for how much), `subscription.updated`,
`subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. `config.kind`
narrows to one kind; empty takes all six. Outputs `{ event, kind, account,
userId? }` — "on payment failed → email the user" or "on purchase → provision"
is this trigger, a template, and one more node. Because it fires after the
role is projected, the buyer is already unlocked when your workflow runs.
Provider-neutral by construction: swap Stripe out later and this workflow
doesn't change.
