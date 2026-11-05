The search corpus for the docs palette, at `GET {mount}/api/search-index`:
`pages` (one entry per nav page with its chapter slug, file, title and its
`#` to `###` headings) and `ops` (every registered op type with its
description). Search runs in the browser over this payload, so the server
does no querying. Op prose files are not indexed; the op entry carries only
the registry description. The page list is memoized per process like
`docs.manifest`. Gated by the docs `requireAuth` policy.
