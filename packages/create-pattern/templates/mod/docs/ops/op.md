The example op shipped with `{{pkgName}}` — returns a static list of items. It's a
placeholder for your mod's real logic; the route in `src/routes.ts` fronts it so
it stays HTTP-free. Replace its `execute` (and these notes) with the real thing,
then run `npx pattern ops {{opPrefix}}` to confirm it registers.
