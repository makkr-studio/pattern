The billing trigger: fires once per normalized provider event, AFTER
verification, dedup and role projection — checkout.completed,
subscription.updated, subscription.deleted, invoice.paid,
invoice.payment_failed. `config.kind` narrows to one kind; empty takes all
five. Outputs `{ event, kind, account, userId? }` — "on payment failed →
email the user" is this trigger, a template, and email.send. Provider-neutral
by construction: swap Stripe out later and this workflow doesn't change.
