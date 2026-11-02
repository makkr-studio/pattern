The whole documentation as one markdown body for machine readers, at
`GET {mount}/llms.txt` (`text/markdown`). Every chapter in order, every nav
page in nav order with frontmatter stripped, then a generated op reference:
one `##` section per op with its description, input and output port names
with their kinds, and control-outs. Schemas and op prose files are left out
to keep it compact.

Point an agent at this URL when it should learn the installation in one
fetch. It reflects the mods actually loaded, and the route takes precedence
over the docs SPA mount. Gated by the docs `requireAuth` policy, so a
private install needs the agent to authenticate.
