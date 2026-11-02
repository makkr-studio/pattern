Speech to text. Wire the recording as a MediaRef on `audio` (the `ref` from
`store.blob.put`, typically after an upload) and get `text`, plus `segments`
(`[{ text, startSecond, endSecond }]` when the provider returns timings),
`language` and `durationMs` (empty string and 0 when the provider omits them).

Wire one of the two: `audio` reads the bytes from mod-store's blob store, and
`audioBytes` takes raw bytes already in hand (it wins when both are wired).
Config `language` names the spoken language; it is sent in the provider's
options, for providers that accept a hint.
Wire a transcription model (`modality: "transcription"`), for example
`gpt-4o-transcribe` on `openai`. Feed `text` into `agents.run` or
`ai.text.generate` to act on what was said.
