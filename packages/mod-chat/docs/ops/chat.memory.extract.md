Turn-end memory RECONCILIATION, running as its own event-triggered run (the
`chat.memory.pipeline` workflow subscribes it to `chat.turn.completed`). One
model call — through the `memory` alias when defined (point it at a mini
model; this is classification, not prose), else the default — receives the
exchange AND the user's existing nearby memories (ids included) and answers
with operations: `add` a new durable fact, `supersede` an outdated one (the
revision keeps `revises` lineage), or `forget` one the user disowned. Ids are
validated against the fetched neighbor set, so a hallucinated id can never
touch another user's rows. Everything indexed carries provenance meta
`{ userId, conversationId, sourceRunId, learnedAt }`, and a per-user cap
(default 200, newest kept) stops unbounded growth. Skips guests; no-ops
without mod-vectors, a model, or the embedding alias.
