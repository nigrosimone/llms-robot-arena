Implement the controller `{{id}}` for the model {{name}} ({{provider}}) in this repository.

Read AGENTS.md first: it has the rules, the bot contract, the black-box policy and the evaluation protocol. Then:

1. Write one file, `packages/bots/{{id}}.js`, exporting exactly one function `tick(sensors, memory)`. Its catalog entry is already in `bots.json`.
2. Check it with `node packages/runtime/gate-cli.js packages/bots/{{id}}.js` and fix every failed check.
3. Run the iterative comparison against Baseline with the manifest already in place:
   `node packages/tournament/cli.js --bots match-{{id}}.json --out results/{{id}}/iteration-N --mode iterative --budget fuel`
   Iterate on your controller until it beats Baseline over the 20-match series (more wins than losses), one results directory per iteration.
4. Only `packages/bots/{{id}}.js` is yours to edit. Do not read other controllers, replays or runtime internals to gain an advantage, and do not change the engine, the runtime, the gate or the tournament code.
5. When you are done, reply with the bot path, the final series result and any remaining limitation.
