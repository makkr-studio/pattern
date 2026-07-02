Delete any conversation and its turns from the admin, regardless of owner: the
privileged counterpart to `chat.conversations.delete` (which scope-checks the
caller). Cascades over turns then the conversation, reporting `turnsDeleted`;
not transactional, so a mid-cascade failure can orphan turns. Admin-route-gated.
Never expose without the admin scope.
