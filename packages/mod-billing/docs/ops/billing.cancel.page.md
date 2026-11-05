Render the checkout cancel landing: the buyer backed out at the provider, no
charge was made, and this page says exactly that with a way back (`next`,
relative-path guarded, or home). Backs the seeded `GET /billing/cancel` route;
not meant for canvas reuse.
