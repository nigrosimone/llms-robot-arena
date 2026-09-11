# Angular spike

A time-boxed try of the Tappa 3 architecture: Angular 22 (zoneless, standalone, signals) hosting the existing JavaScript packages unchanged. Not a migration, not parity: only the arena panel, to see where the framework bites.

## What is here

- `src/app/arena/match.service.ts`: the slow state in signals (roster, seed, spawn, status, progress, the loaded replay, a HUD sampled at 10 Hz). The worker messages `replay`, `live-start`, `live-tick`, `live-end` are handled here; the 60 Hz `live-tick` stream is appended to the growing replay object and read by the viewer, never through a signal or a template.
- `src/app/arena/arena-page.ts`: the stage, playback controls, robot cards, the sidebar with the same CSS classes as the current viewer. The `ArenaViewer` from `packages/viewer/arena.js` is mounted in `afterNextRender` and disposed with the page; the replay outlives the page in the service and is reloaded on return.
- Routes `/`, `/lab`, `/tournament`, `/rules`: the arena in the initial bundle, the others lazy placeholders. The match query string (`?a&b&seed&spawn`) is read and written exactly as today.
- `tools/bots.mjs` writes `src/generated/bots.ts` (the catalog with sources, what the `arena:bots` esbuild plugin does for the current build); `tools/workers.mjs` bundles `bot-worker.js` into `public/` because the Angular builder bundles only the worker it sees in the app, not the one that worker spawns.
- Stylesheet: `packages/viewer/public/style.css` imported as is.

Build and run:

```sh
cd apps/web
node tools/bots.mjs && node tools/workers.mjs
npx ng build
npx serve -s dist/web/browser
```

## Measured

- Initial bundle 1.04 MB raw, 240 kB estimated transfer (gzip), against 210 kB of the current `app.js` plus 8 kB of CSS: about +10%, inside the 15% budget of the plan, before any lazy split of three.js itself.
- Opening match simulated in the bundled match worker, playback at 60 Hz with the HUD at 10 Hz, panel switch and back without reload, keyboard match driving the robot: all verified in headless Chrome with the GPU.
- `ng build` takes about 6 s.

## What bites

1. The nested worker: the runtime spawns `bot-worker.js` from inside `match-worker.js`, the builder does not follow it. Either prebuild it as an asset (done here) or move both workers to a place the builder handles.
2. Everything from `packages/` is imported as untyped JavaScript (`allowJs`, `any`): fine for a spike, a migration wants `.d.ts` files or JSDoc types for `ArenaViewer`, the replay and the worker messages.
3. The viewer is destroyed and recreated on every route change; a migration should keep one renderer alive and re-attach its canvas, as the plan says (`packages/renderer` with `mount` and `dispose`).
4. Template bindings on `<select>` need `[selectedIndex]`, `[value]` is applied before the options exist.
5. `routerLinkActive` must ignore query params, otherwise the arena link is never active on a match URL.

## Not done

Bot Lab, tournament, rules content, the result banner actions, challenge links, touch, recording, the event log, camera views, sound, import and export, prerendered pages, the deploy. Each is a port of code that already exists in `app.js`; nothing found here blocks it.
