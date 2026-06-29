Fires when a WebSocket disconnects, with `code`/`reason`. Use it to clean up
room membership or presence state. Note: the connection is already gone;
any attempt to send to it will fail.
