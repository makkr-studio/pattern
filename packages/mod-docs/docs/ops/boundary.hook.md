Splices a workflow into a named hook chain. Hooks are the extensibility
backbone: a priority-ordered filter chain that threads a payload through
every registered workflow (`payload` in → `boundary.hook.return` out, with
optional `stop: true` to short-circuit). Use events for notifications, hooks
for "let mods transform/veto this".
