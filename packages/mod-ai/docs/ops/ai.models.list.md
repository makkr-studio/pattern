The model catalog for pickers: mod-ai's static suggestions for direct providers
merged with the live Vercel AI Gateway listing, each entry `{ id, provider,
routing, displayName?, modalities, capabilities }`. The AI Providers form uses
it for model-id suggestions filtered by provider and modality.

The live part appears only when an `AI_GATEWAY_API_KEY` is set (env var or
unlocked vault); it is cached for five minutes, and an unreachable gateway
leaves the static list in place. The catalog is a list of suggestions: an
alias or `ai.model` accepts any model id the provider serves. Served at
`GET /admin/api/ai/models` behind the admin scope.
