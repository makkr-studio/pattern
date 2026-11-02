Text to speech: wire `text` and get `audio`, raw media `{ bytes, mime, kind:
"audio" }`. Persist it with `store.blob.put` and hand the resulting MediaRef
(its `ref` output) to a player.

Config `voice`, `speed` and `format` (the output format, such as `mp3` or
`wav`) pass through to the provider; voice names and supported formats are
provider-specific. The optional `instructions` input steers tone and style on
models that support it, for example OpenAI's `gpt-4o-mini-tts` with "Speak
warmly and slowly"; other models ignore it. Wire a speech model
(`modality: "speech"`). Pairs with `ai.transcribe` for a voice round trip and
with `ai.text.generate` or `agents.run` for the words to speak.
