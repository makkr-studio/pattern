The Resend inbound webhook handler: raw body bytes + headers in, a verified
`email.inbound` event out. Verifies the svix signature (constant-time
HMAC-SHA256 over the exact bytes, ±5 minute timestamp window, multi-signature
tolerant) against the account's `webhookSecret` secret, parses the
`email.received` payload, stores base64 attachments as blobs, and hands the
message to mod-email's ingest — the `email.inbound` trigger fires from there.
Other Resend event types are acknowledged and ignored.

Wire it behind a trigger with `bodyMode: "stream"` — the signature covers the
RAW bytes, and a JSON-parsed body is not the signed content. The seeded
`email.resend.inbound` workflow (POST /email/inbound/resend) is exactly that
wiring; bad signatures answer 401 via `boundary.http.status`.
