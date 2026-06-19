One conversation's metadata for the admin detail view — owner label, ids,
history size, timestamps. Unlike `chat.conversations.get` it does NO scope check
(`privileged`, gated by its admin route), so it sees any owner's conversation.
Returns `{ error }` rather than an httpOutcome when missing — the admin view
renders it inline.
