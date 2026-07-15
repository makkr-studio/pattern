Buddy's retrieval op: search the live handbook (every mod's docs chapter) and
the op catalog in one query. Returns `{ results: [{ title, path, snippet,
score }] }` — `path` is `guide/<chapter>/<file>` for handbook pages and
`op/<type>` for catalog hits.

Two engines, one shape: the baseline is lexical (token overlap over titles,
headings, op types and descriptions — genuinely strong on this corpus of
structured docs and exact op names). When `@pattern-js/mod-vectors` and an
embedding alias (`buddy`, falling back to `default`) are installed, the same
op silently upgrades to semantic retrieval. Nothing downstream changes.

This is the body of the `pattern_search_docs` tool; wire it directly anywhere
you want docs-grounded answers.
