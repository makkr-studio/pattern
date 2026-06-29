Validate against a JSON Schema (the `schema` input, else config). Outputs
`valid`, the parsed/coerced `value`, and located `errors`: branch on
`valid`, consume the coerced value downstream. Same compiler the engine uses
for trigger payloads, exposed mid-graph.
