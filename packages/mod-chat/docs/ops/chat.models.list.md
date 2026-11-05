The source of truth for the chat header's model switcher, served at
`GET {mount}/api/:ns/models` under the same `requireAuth` policy as the
conversation routes. It reads mod-ai's alias config and emits `{ models:
[{ name, provider, modelId }] }` for the aliases whose modality is
`language`, a shape that carries no credentials. Embedding, image and speech
aliases are left out.

With mod-ai absent the list is empty and the switcher has nothing to offer.
The `:ns` segment is accepted for route symmetry; every namespace sees the
same aliases. The name the user picks travels in the turn body as `model` and
is resolved by `chat.model.resolve`.
