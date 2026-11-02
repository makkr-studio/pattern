The email drivers registered in this installation, each as `{ id, label,
secrets, options }` where `secrets` and `options` list field descriptors
(`{ field, label, required? }`; option fields may add a `placeholder`). The admin Email page builds its
account form from this, at `GET /admin/api/email/providers` behind the `admin`
scope. A driver appears once its mod (`@pattern-js/mod-email-resend`,
`@pattern-js/mod-email-smtp`, or your own `registerDriver` call) is
installed; an empty list means nothing can send yet. Use the field names here
as the keys of an account's `secrets` and `options` when you call
`email.accounts.write`.
