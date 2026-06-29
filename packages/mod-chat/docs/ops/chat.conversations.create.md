Create a conversation in a namespace, minting the anonymous device session for
guests. The minted device id rides the op's `cookies` output port. Wire it to
the response so the guest is stable on the next request; signed-in callers scope
by `user` and get no cookie. Returns HTTP 201. Pairs with
`chat.conversations.list`, which partitions by the same namespace.
