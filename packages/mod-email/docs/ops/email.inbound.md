The inbound email trigger: a workflow starting here runs once per received
message. Set `config.account` to listen to one receiving account, or leave it
empty for every account. Outputs `{ message, account }` — `message` carries
from/to/cc, subject, text/html bodies, lower-cased headers, threading ids
(messageId, inReplyTo, references) and `attachments` as blob references
(`{ blobId, filename, mime, size }`; bytes need mod-store).

Fire-and-forget by design: the sender's mail server never reads your run's
result, so an out-gate is optional — add `boundary.return` only to record an
outcome on the run. Delivery comes from a webhook driver
(`@pattern-js/mod-email-resend` ships one, signature-verified); pair with
`email.reply` for properly threaded answers.
