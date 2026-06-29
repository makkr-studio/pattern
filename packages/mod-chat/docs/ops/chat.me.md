The SPA's first call: who the caller is and whether auth is required, so the app
can render its own sign-in card and avoid a raw 401. Its route is
ALWAYS open even when `requireAuth` gates the rest. Keep it that way if you fork
it. Resolves the auth policy with the same `{ env }` semantics as the scoped
routes, so the verdict it reports matches what `chat.conversations.create` will
enforce.
