Shallow-merge a patch into a document: CAS only (`version` required), so it
never resurrects a deleted doc or races a concurrent write. For deep merges
shape the object yourself (`core.object.mergeDeep`) and `store.put`.
