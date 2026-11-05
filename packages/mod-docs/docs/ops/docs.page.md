One rendered page, at `GET {mount}/api/page?chapter=<slug>&file=<path>`. It
returns `{ chapter, file, title, markdown }` with the frontmatter stripped
and the title resolved from frontmatter `title`, then the first `# heading`,
then the file name. Use it to show a chapter page; chapter slugs and file
paths come from `docs.manifest`.

`file` is confined to the chapter's filesystem: it must be a relative `.md`
path with no `..`, backslash or leading slash. A bad path, an unknown chapter
or a missing file all produce a `not_found` outcome, which the route maps to
404. For the bytes with frontmatter intact use `docs.raw`. Gated by the docs
`requireAuth` policy.
