Wrap a `boundary.tool` workflow (one that returns `{ tripwire, info? }`) as an
input or output guardrail and feed it into `agents.agent`'s guardrails input.
A tripped guardrail surfaces as an inline card in the chat — the run ends
cleanly with the reason, never a crash. Input guardrails vet the user's
message before the model sees it; output guardrails vet the model's answer.
