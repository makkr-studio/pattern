A page's markdown exactly as shipped, frontmatter included, served as
`text/markdown` at `GET {mount}/raw?chapter=<slug>&file=<path>`. It backs
the "view as markdown" link and suits agents or scripts that want one page
without the SPA. Same path rules and `not_found` outcome as `docs.page`,
which you want instead when you need the resolved title or the stripped
body. For the whole doc set in one body use `docs.llms`. Gated by the docs
`requireAuth` policy.
