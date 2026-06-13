The generic app descriptor: serve a registered filesystem as a static site
(with `spaFallback` for client routing). Register the fs in a mod's setup
(`provideFilesystem`), wire this between `boundary.http.app` and
`boundary.http.app.serve` — that's a deployed frontend with zero server code.
