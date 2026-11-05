A plain-text structural summary of a workflow, built by walking the graph
with no model involved, so the same doc always yields the same text. It names
the workflow and its description, lists for each trigger the steps reachable
from it in breadth-first order (node title, else op title, else op type), and
ends with the out-gates that deliver the result. Output: `{ text }`.

The slug resolves to the registered workflow first, then to the stored live
version; a workflow that is neither answers 404. Handy as a cheap, stable
description to hand a model or paste into a review.

Route: `GET /admin/api/workflows/:slug/explain`. Scope: `workflows:read`.
