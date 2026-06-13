Mint an ephemeral realtime client secret (`ek_…`) for a browser↔OpenAI voice
session — `apiKey` in (resolved like `agents.run`'s), `{ ephemeralKey,
expiresAt }` out. The voice round's foundation: the short-lived key is safe to
hand to the browser, which opens the WebRTC session directly. Pre-wired now,
surfaced when the voice UI lands.
