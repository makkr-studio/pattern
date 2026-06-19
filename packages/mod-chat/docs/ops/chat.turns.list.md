A conversation's turns WITH their persisted event logs — the replay source the
SPA reduces to rebuild a transcript (including a mid-flight turn on refresh).
Scope-checked like `chat.conversations.get`. Heavier than the conversation list
(full event arrays); fetch it per-conversation, not for the sidebar.
