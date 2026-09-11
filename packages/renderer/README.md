# renderer

The three.js viewer and everything drawn or heard around a replay: arena, terrain, effects, particles, floor wear, camera, playback sampling, sound, the real-time recorder and the offline clip. Plain JavaScript with an imperative API (`ArenaViewer`: `load`, `seek`, `toggle`, `setFocus`, `dispose`, plus `beginOffline` / `renderAt` / `endOffline` for clips); the `.d.ts` files next to the modules are the contract for typed callers. It knows nothing about the page, the catalog or the site: it is fed replays and frames and it draws.
