One conversation's metadata for the admin detail view: owner label, ids,
history size, timestamps. It does NO scope check (`privileged`, gated by its
admin route), so it sees any owner's conversation; `chat.conversations.get` is
the scoped sibling. Returns `{ error }` (not an httpOutcome) when missing; the
admin view renders it inline.
