Write a document. Without `version` it's an upsert; WITH it, a compare-and-swap:
`ok:false` on a lost race (someone else wrote first), so re-read and retry to
avoid clobbering. The CAS path is what makes concurrent writers safe; reach for
it whenever two runs might touch the same doc.
