Reply to an inbound message with real threading: wire `message` straight from
an `email.inbound` trigger and this op derives everything — the recipient
(the original's reply-to header, else its sender), the subject (`Re: `
prefixed once, never `Re: Re:`), and the RFC-5322 threading headers
(In-Reply-To = the original's message id; References = its references + that
id), so mail clients stack the exchange as one conversation.

Write the body once in `markdown` (rendered to styled HTML + a plain-text
alternative) or pass explicit `html`/`text`. Sends through the account the
message arrived on unless `config.account` says otherwise.
