Delete a conversation and all its turns, scope-checked against `user`/`device`.
Cascades over the turn docs first, so a partial failure can leave orphan turns.
It is not transactional. For the admin surface (any owner, no scope check) use
`chat.admin.conversation.delete` instead.
