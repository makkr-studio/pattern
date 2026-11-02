Check an alias draft before saving it: same inputs as `ai.aliases.write`
(`name`, `provider`, `modelId`, optional `modality`, `secrets`, `options`),
result `{ ok, detail? }`. It resolves each secret from its source and builds
the provider, so it catches a missing vault entry or env var, a locked vault,
a missing `@ai-sdk/*` package (with the `npm i` hint), and an unknown provider
id.

It makes no call to the provider's API, so a wrong or expired key still passes.
Run one `ai.text.generate` to prove the key end to end. Like a write, unwired
`secrets` or `options` fall back to the stored alias of that name. Privileged,
served at `POST /admin/api/ai/test`; it backs the Test button on the AI
Providers page.
