# LLMs Robot Arena

An arena where **LLMs write robot controllers and their code competes**.

Give a coding agent the game rules, let it build a bot, and watch its decisions play out against other submissions. Every robot has the same body, motors and front wedge. The difference is the code controlling it.

> It's not an AGI benchmark. It tests how coding agents turn the same dynamic specification into an autonomous controller.

**[Open the live arena](https://llms-robot-arena.sndesign.it/)**

[![Open the live arena](./video.gif)](https://llms-robot-arena.sndesign.it/)

[Rules and agent instructions](AGENTS.md)

The online version runs simulations in your browser. No installation, account or API key is needed to try the included bots.

## What happens in a match?

Two autonomous robots fight on a suspended platform with no walls. They can push each other over the edge, force an opponent into a hole, or use the front wedge to flip it. Falling or taking a second flip ends a robot's match.

Surviving also means reading the arena:

- **Energy is limited.** Moving and turning consume it; entering a ready blue recharge cell restores some. Waiting does not recharge a robot.
- **The floor is dangerous.** Holes cause an immediate loss, and flame grates warn before burning and draining energy.
- **Standing still has consequences.** Robot weight wears down tiles until they collapse. Other tiles can disappear after a warning, and the arena shrinks as time passes.

A match lasts up to two minutes. If both robots survive, fewer flips taken, remaining energy and distance to the center decide the outcome, in that order. Exact ties can still be draws.

The challenge combines attacking, steering, energy management and hazard avoidance. A controller that looks convincing on paper still has to survive the arena.

## Explore the arena

Open the live site to automatically simulate and play the default match. Choose two controllers, a seed and a spawn layout, then select **Simulate match** to run another contest. The seed makes the arena layout and environmental events repeatable. A direct replay link opens that replay instead.

The complete match is calculated before playback. You can pause, scrub through the replay, change its speed and inspect the event log. The automatic camera keeps both robots in view; **Manual camera** lets you orbit, pan and zoom yourself. Replays can be exported and imported as JSON.

**Play yourself vs Robot B** puts you at the keyboard (WASD or arrows, on-screen buttons on a phone) against the selected controller in real time. When the match ends, **Copy challenge link** gives you a link that rebuilds your match from its input log: whoever opens it watches your run and can try to beat it on the same seed against the same controller. No account, no server.

| Area | What you can do |
| --- | --- |
| **Arena** | Run individual matches and watch the results in 3D, with energy bars, robot status and an event log. |
| **Bot Lab** | Create or edit a JavaScript controller, check that it follows the bot contract, and download its source. |
| **Tournament** | Compare selected bots across repeated matches and export rankings and reports. |
| **Rules** | Read a short overview of the game mechanics. |

Bot Lab changes last for the current browser session. Download your controller to keep a copy.

## Where do the LLMs come in?

An LLM writes the controller before the match. During the match, that JavaScript program receives the robot's sensors and chooses how much to drive and turn. It runs automatically inside an isolated execution environment; the arena makes no LLM API calls.

This makes the project a way to explore how well coding agents turn a shared specification into working strategies. You can also write a controller yourself and test it in your local arena.

To have an agent build a bot, give it **[AGENTS.md](AGENTS.md)**. That file contains the complete rules, programming contract and evaluation procedure, including the requirement to beat the basic Baseline controller and to treat competing implementations as black boxes.

## Current standings

The published standings come from one exhibition tournament run with `npm run standings`, on the whole catalog. The Tournament page shows them when it opens; start a tournament there to run your own in the browser. The play style numbers come from the same matches and are only comparable inside this run. The implementation numbers are measured from each controller's source.

<!-- standings:start -->

Round robin (10 seeds per pair, mirrored spawns) · 1560 matches · fuel budget · spec 0.2.2-draft / engine 0.2.2-r2 · generated 2026-09-11.

| # | Controller | Provider | Thinking | Harness | Development | Source | Strength | 95% CI | Score % | W / D / L |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GPT-6 Astra | OpenAI | ultra | Codex | iterative | [gpt-6-astra-ultra.js](packages/bots/gpt-6-astra-ultra.js) | 228.7 | 182.9 – 282.4 | 74.2 | 174 / 8 / 58 |
| 2 | Fable 5.1 | Anthropic | max | Claude Code | iterative | [fable-5-1-max.js](packages/bots/fable-5-1-max.js) | 190.5 | 154.3 – 236.4 | 70.0 | 166 / 4 / 70 |
| 3 | GPT-5.6 Terra | OpenAI | ultra | Codex | iterative | [gpt-5-6-terra-ultra.js](packages/bots/gpt-5-6-terra-ultra.js) | 127.4 | 104.2 – 159.6 | 60.0 | 135 / 18 / 87 |
| 4 | Claude Sonnet 5 | Anthropic | max | Claude Code | iterative | [sonnet-5-max.js](packages/bots/sonnet-5-max.js) | 111.2 | 89.1 – 135.1 | 56.5 | 127 / 17 / 96 |
| 5 | DeepSeek V4 Pro 0813 | DeepSeek | — | OpenCode | iterative | [deepseek-v4-pro-0813.js](packages/bots/deepseek-v4-pro-0813.js) | 106.9 | 85.6 – 129.4 | 55.4 | 122 / 22 / 96 |
| 6 | Claude Opus 5.1 | Anthropic | max | Claude Code | iterative | [opus-5-1-max.js](packages/bots/opus-5-1-max.js) | 92.1 | 74.3 – 112.3 | 51.5 | 117 / 13 / 110 |
| 7 | Claude Haiku 4.5 | Anthropic | max | Claude Code | iterative | [haiku-4-5-max.js](packages/bots/haiku-4-5-max.js) | 91.4 | 73.3 – 110.8 | 51.2 | 111 / 24 / 105 |
| 8 | GPT-5.5 | OpenAI | xhigh | Codex | iterative | [gpt-5-5-xhigh.js](packages/bots/gpt-5-5-xhigh.js) | 79.4 | 64.7 – 96.4 | 47.5 | 102 / 24 / 114 |
| 9 | GLM 5.3 Flash | Z.ai | — | OpenCode | iterative | [glm-5-3-flash.js](packages/bots/glm-5-3-flash.js) | 71.2 | 57.9 – 86.5 | 44.6 | 97 / 20 / 123 |
| 10 | GPT-5.6 Sol | OpenAI | ultra | Codex | iterative | [gpt-5-6-sol-ultra.js](packages/bots/gpt-5-6-sol-ultra.js) | 67.3 | 54.3 – 81.1 | 43.1 | 89 / 29 / 122 |
| 11 | GPT-5.6 Luna | OpenAI | max | Codex | iterative | [gpt-5-6-luna-max.js](packages/bots/gpt-5-6-luna-max.js) | 62.2 | 49.6 – 75.1 | 41.0 | 88 / 21 / 131 |
| 12 | Baseline | Reference controller | — | — | reference | [baseline.js](packages/bots/baseline.js) | 37.2 | 29.0 – 46.1 | 28.3 | 58 / 20 / 162 |
| 13 | GPT-5.3 Codex Spark | OpenAI | xhigh | Codex | iterative | [gpt-5-3-codex-spark-xhigh.js](packages/bots/gpt-5-3-codex-spark-xhigh.js) | 34.5 | 26.3 – 43.3 | 26.7 | 52 / 24 / 164 |

**Play style.** Measured from the recorded frames of the same matches. The profile names the axis where a controller stands out most against this roster.

| Controller | Profile | Contact | Closing | Wedge | Engagements / min | Speed | Turn rate | Edge time | Energy / s | Recharges |
|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | Energy burn | 25% | 42% | 67% | 7.5 | 1.19 m/s | 0.60 rad/s | 4% | 13.6 | 4.0 |
| Fable 5.1 | Edge play | 15% | 37% | 65% | 9.4 | 0.88 m/s | 0.67 rad/s | 27% | 9.3 | 1.6 |
| GPT-5.6 Terra | Energy burn | 28% | 38% | 66% | 5.5 | 0.80 m/s | 0.50 rad/s | 5% | 11.5 | 2.1 |
| Claude Sonnet 5 | Aggression | 30% | 39% | 56% | 6.7 | 0.65 m/s | 0.53 rad/s | 4% | 10.9 | 0.9 |
| DeepSeek V4 Pro 0813 | Aggression | 27% | 42% | 62% | 8.2 | 1.17 m/s | 0.78 rad/s | 5% | 12.0 | 1.4 |
| Claude Opus 5.1 | Mobility | 15% | 24% | 47% | 7.8 | 1.66 m/s | 0.87 rad/s | 7% | 8.9 | 2.1 |
| Claude Haiku 4.5 | Energy burn | 33% | 44% | 78% | 7.2 | 1.13 m/s | 0.50 rad/s | 6% | 13.8 | 1.4 |
| GPT-5.5 | Aggression | 35% | 47% | 89% | 4.8 | 0.89 m/s | 0.24 rad/s | 7% | 13.9 | 0.3 |
| GLM 5.3 Flash | Energy burn | 28% | 29% | 44% | 7.2 | 0.91 m/s | 0.63 rad/s | 13% | 11.7 | 0.8 |
| GPT-5.6 Sol | Pressure | 35% | 39% | 66% | 5.0 | 0.64 m/s | 0.40 rad/s | 5% | 12.6 | 1.1 |
| GPT-5.6 Luna | Aggression | 30% | 40% | 71% | 5.1 | 0.78 m/s | 0.50 rad/s | 1% | 11.4 | 0.8 |
| Baseline | Pressure | 33% | 46% | 87% | 4.2 | 0.87 m/s | 0.30 rad/s | 6% | 13.2 | 0.3 |
| GPT-5.3 Codex Spark | Pressure | 34% | 42% | 68% | 5.8 | 1.12 m/s | 0.46 rad/s | 8% | 12.1 | 0.5 |

**Highlights.** The matches worth watching: total flips first, then engagements. Each link simulates the match again in the arena.

| Match | Seed / spawn | Flips | Engagements | Result | Watch |
|---|---|---|---|---|---|
| GPT-6 Astra vs Fable 5.1 | 4 / mirrored | 3 | 5 | GPT-6 Astra wins, flips at 59 s | [simulate](https://llms-robot-arena.sndesign.it/?a=gpt-6-astra-ultra&b=fable-5-1-max&seed=4&spawn=mirror) |
| Fable 5.1 vs Claude Opus 5.1 | 1 / mirrored | 2 | 12 | Claude Opus 5.1 wins, flips at 62 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=opus-5-1-max&seed=1&spawn=mirror) |
| Fable 5.1 vs Claude Haiku 4.5 | 5 / mirrored | 2 | 11 | Fable 5.1 wins, hole at 32 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=haiku-4-5-max&seed=5&spawn=mirror) |
| Claude Sonnet 5 vs GLM 5.3 Flash | 7 / standard | 2 | 11 | GLM 5.3 Flash wins, flips at 31 s | [simulate](https://llms-robot-arena.sndesign.it/?a=sonnet-5-max&b=glm-5-3-flash&seed=7&spawn=normal) |
| GPT-6 Astra vs Fable 5.1 | 8 / mirrored | 2 | 9 | Fable 5.1 wins, flips at 44 s | [simulate](https://llms-robot-arena.sndesign.it/?a=gpt-6-astra-ultra&b=fable-5-1-max&seed=8&spawn=mirror) |

**Implementation.** Measured from the submitted source: cyclomatic complexity counts branches and short-circuit operators, nesting counts functions and control statements.

| Controller | Language | Lines | Code | Comments | Functions | Cyclomatic | Max nesting | Size |
|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | js | 246 | 221 | 17 | 9 | 181 | 6 | 12.8 kB |
| Fable 5.1 | js | 591 | 490 | 102 | 15 | 518 | 13 | 35.4 kB |
| GPT-5.6 Terra | js | 459 | 423 | 4 | 7 | 164 | 8 | 15.4 kB |
| Claude Sonnet 5 | js | 383 | 296 | 70 | 7 | 191 | 8 | 19.5 kB |
| DeepSeek V4 Pro 0813 | js | 135 | 122 | 0 | 3 | 61 | 7 | 4.4 kB |
| Claude Opus 5.1 | js | 450 | 362 | 69 | 10 | 275 | 7 | 23.4 kB |
| Claude Haiku 4.5 | js | 65 | 54 | 0 | 1 | 26 | 5 | 1.9 kB |
| GPT-5.5 | js | 59 | 50 | 0 | 1 | 23 | 4 | 1.5 kB |
| GLM 5.3 Flash | js | 397 | 348 | 26 | 8 | 152 | 9 | 13.0 kB |
| GPT-5.6 Sol | js | 609 | 564 | 0 | 10 | 201 | 10 | 19.9 kB |
| GPT-5.6 Luna | js | 306 | 285 | 0 | 5 | 112 | 6 | 9.9 kB |
| Baseline | js | 18 | 15 | 2 | 1 | 4 | 2 | 0.4 kB |
| GPT-5.3 Codex Spark | js | 173 | 143 | 0 | 1 | 76 | 5 | 4.8 kB |

**Craft index.** One number over results and source: a weighted geometric mean of strength (45%), reliability (20%), consistency (15%), efficiency (10%) and maintainability (10%). Every term is scaled 0 to 1, the first four against this roster and maintainability against ten branches per function and four levels of nesting. It is not the ranking: strength alone decides that.

| Controller | Craft index | Strength | Reliability | Consistency | Efficiency | Maintainability |
|---|---|---|---|---|---|---|
| GPT-6 Astra | 91.3 | 1.00 | 1.00 | 0.78 | 1.00 | 0.58 |
| Fable 5.1 | 76.2 | 0.83 | 1.00 | 0.78 | 0.73 | 0.30 |
| GPT-5.6 Terra | 63.9 | 0.56 | 1.00 | 0.78 | 0.50 | 0.46 |
| Claude Sonnet 5 | 59.4 | 0.49 | 1.00 | 0.79 | 0.46 | 0.43 |
| DeepSeek V4 Pro 0813 | 60.3 | 0.47 | 0.99 | 0.80 | 0.52 | 0.53 |
| Claude Opus 5.1 | 53.8 | 0.40 | 1.00 | 0.79 | 0.37 | 0.47 |
| Claude Haiku 4.5 | 56.7 | 0.40 | 0.97 | 0.79 | 0.54 | 0.59 |
| GPT-5.5 | 53.7 | 0.35 | 0.97 | 0.80 | 0.48 | 0.72 |
| GLM 5.3 Flash | 46.8 | 0.31 | 0.98 | 0.80 | 0.29 | 0.49 |
| GPT-5.6 Sol | 44.8 | 0.29 | 1.00 | 0.80 | 0.25 | 0.45 |
| GPT-5.6 Luna | 44.1 | 0.27 | 0.97 | 0.79 | 0.26 | 0.56 |
| Baseline | 37.6 | 0.16 | 0.97 | 0.77 | 0.31 | 1.00 |
| GPT-5.3 Codex Spark | 31.4 | 0.15 | 0.96 | 0.75 | 0.16 | 0.47 |

<!-- standings:end -->

## Try it with your own agent

You need Node.js 24 or newer and a coding agent. Give it this prompt:

> Clone https://github.com/nigrosimone/llms-robot-arena, run `npm ci`, then read AGENTS.md and write your bot following it.

AGENTS.md carries the rest: the rules, the controller contract, the validation commands and the black-box policy. Then run `npm start` and open http://127.0.0.1:8080 to watch your bot fight in the arena.

## Understanding the results

Browser tournaments default to **Quick rounds**: up to three rounds against different opponents, with one seed and both spawn assignments per pairing. With six bots this runs **18 matches instead of 300**. Odd rosters have rotating byes without points. Results and provisional rankings update after each match; select **Watch** beside a completed match to view its replay while the tournament continues. Cancelling keeps the completed results available for viewing and export.

Choose **Full round robin** for ten seeds with swapped starting positions: **20 matches per pair of bots**. This is also the standard CLI evaluation protocol. Full tournaments include seed-bootstrap uncertainty estimates when complete. Quick rounds sample fewer opponents and seeds, so they omit those intervals. Exported results identify the format, completion status, controllers and execution conditions, including each controller's separate model, thinking level and harness.

Browser tournaments are exhibitions with a reproducible instruction budget. The command-line runner also supports the separate timing budget and one-shot evaluation protocol described in [AGENTS.md](AGENTS.md). Results describe the submitted controllers under those conditions; a bot's model name alone does not establish how it was developed.

Exhibition admission checks the controller contract and instruction budget. The measured 2 ms timing check is advisory for these matches, because it depends on the device and browser load. Expand a controller's checks in Tournament to see its results. Full conformity still requires the timing check; `--budget wall` evaluations and the standalone conformity gate enforce it. Exports record admission and full conformity separately.

For local setup, command-line evaluation and development commands, see [Operating and publishing the project](AGENTS.md#operating-and-publishing-the-project).

## Contributing

Platform fixes, tests and documentation improvements are welcome. We do **not** accept pull requests adding new models or model-attributed bots: we cannot verify that a controller was generated by the claimed model. To request a model, contact [Simone Nigro](mailto:nigro.simone@gmail.com) to arrange API-key access; Simone will generate, evaluate and register it. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution policy and development workflow.
