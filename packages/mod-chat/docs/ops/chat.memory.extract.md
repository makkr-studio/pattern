Turn-end memory extraction, running as its own event-triggered run (the
`chat.memory.pipeline` workflow subscribes it to `chat.turn.completed`): a
one-shot model call reads the completed exchange and answers with the durable
facts about the user worth keeping — stable preferences, personal facts,
ongoing projects — as a JSON array; small talk and one-off requests never
qualify. Each statement is indexed into the memory collection (declared with
`filterables: ["userId"]`) with provenance meta `{ userId, conversationId,
sourceRunId, learnedAt }`, so every memory can answer "where did you learn
that?" with a link to the exact run. Skips guests (no durable identity) and
no-ops without mod-vectors, a model, or the embedding alias.
