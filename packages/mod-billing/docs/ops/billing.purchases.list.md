Every recorded one-time purchase, newest first: who bought what (the price
keys), how many, for how much (`amount` in the currency's minor unit,
`currency`), and the provider session that carried it. Backs the Billing
page's Purchases table (admin scope). Purchases are written by the completion
webhook of a payment-mode checkout and keyed by the session id, so a
redelivered event never records a sale twice.
