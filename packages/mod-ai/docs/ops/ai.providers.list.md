List every provider mod-ai knows, straight from its registry: `{ id, label,
routing, optional, pkg, modalities, secrets, options }` per entry. The AI
Providers alias form builds itself from this, showing exactly the secret and
option fields the chosen provider needs (one `apiKey` for most, a
`resourceName` for Azure, a `region` plus AWS keys for Bedrock).

`optional: true` and `pkg` say which `@ai-sdk/*` package must be installed
before an alias on that provider can run; the gateway entry needs none. The
list is static, so it reports what is supported whether or not the package is
installed. Served at `GET /admin/api/ai/providers` behind the admin scope.
