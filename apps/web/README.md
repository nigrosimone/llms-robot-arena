# apps/web

The front end: Angular 22, zoneless, standalone components, signals, `ng-simple-state` stores. It imports the plain JavaScript packages of the repository as they are (`packages/sim`, `runtime`, `tournament`, `renderer`, `site`) and adds only what the page needs: routes, panels, forms and the slow state around a match.

- `src/app/arena`: the arena panel. `ViewerService` owns the one renderer for the life of the app (its canvas host moves in and out of the page), the sound, the intro, the recorder and the offline clip. `ArenaStore` holds settings, the replay on the stage, the live match and the challenge links; the 60 Hz stream from the match worker goes straight to the renderer.
- `src/app/lab`, `src/app/tournament`, `src/app/rules`: the other panels, lazy.
- `src/app/core`: icons, toast, URL helpers, the catalog store and the worker service (one match worker at a time).
- `src/generated/bots.ts` is written by `scripts/build.mjs` from the catalog; the bot worker the match worker spawns is bundled by the same script.

From the repository root, `npm ci --prefix apps/web` once, then `npm run build` (the whole site into `dist/`) and `npm run e2e` (the parity scenarios in a local Chrome). `npx ng build` and `npx ng serve` work from this directory for a quicker loop, after `node ../../scripts/build.mjs` has generated the catalog module once.
