Resolve a named alias from admin → Resources → AI Providers into a model
reference, and wire its `model` output wherever `ai.model` would go. The alias
name defaults to `default` and can also be wired at run time (pick a model per
request, for example from a user setting).

The reference carries only the alias name plus display fields. The provider,
model id, secrets and options are looked up from the alias each time a model is
built, so re-pointing `default` in Settings re-targets every workflow and agent
that uses it on the next run, with no graph edit and no key on the edge.

The node fails if no alias of that name exists, with a message pointing at the
AI Providers page. `agents.run` and `agents.history.compact` fall back to the
`default` alias on their own when no model is wired; the `ai.*` capability ops
require a wired `model`, so put an `ai.alias` node in front of them.
