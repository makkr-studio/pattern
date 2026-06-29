The caller's conversations in one namespace, newest first: the SPA's sidebar
source. Scopes by `user` when signed in, else the `device` cookie; an unscoped
caller (neither) gets an empty list. Filters by namespace
IN MEMORY (legacy/absent reads as `default`), so the shared backend keeps each
branded instance's list separate without a per-namespace index.
