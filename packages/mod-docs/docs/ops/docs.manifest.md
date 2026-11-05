The docs navigation, at `GET {mount}/api/manifest`: one chapter per installed
mod with a `docs` contribution (`{ mod, slug, title, order, index,
filesystem, nav }`), sorted by `order` then title, plus the docs `mount` and
the `adminMount` used for "open in admin" links. The SPA builds its sidebar
from it.

Nav is derived from each chapter's frontmatter unless the mod passes an
explicit `nav`; files under `ops/` never appear. The result is memoized per
process, so a new markdown file shows up after a restart, or immediately
with the mod option `cache: false` while you write docs. A chapter whose
filesystem is not registered is skipped with a warning. Gated by the docs
`requireAuth` policy. Fetch a page's body with `docs.page`.
