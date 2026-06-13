Squeeze a long conversation: items beyond `keepRecent` are summarized into a
single message, the recent tail kept verbatim — `history` in, compacted
`history` out. Drop it between `chat.turn.begin`'s history output and
`agents.run`'s history input: compaction is a VISIBLE node, so you see
exactly when memory gets squeezed (and can swap the summarizer model).
