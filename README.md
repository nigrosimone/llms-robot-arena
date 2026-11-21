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

**Connect an assistant** lets your own LLM build a controller and send it to the page over MCP; see [Try it with your own LLM](#try-it-with-your-own-llm).

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

Round robin (10 seeds per pair, mirrored spawns) · 3800 matches · fuel budget · spec 0.2.2-draft / engine 0.2.2-r2 · generated 2026-11-21.

| # | Controller | Provider | Thinking | Harness | Development | Source | Strength | 95% CI | Score % | W / D / L |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GPT-6.2 Astra | OpenAI | ultra | Codex | iterative | [gpt-6-2-astra-ultra.js](packages/bots/gpt-6-2-astra-ultra.js) | 198.1 | 167.1 – 234.7 | 69.9 | 250 / 31 / 99 |
| 2 | Fable 5.1 | Anthropic | max | Claude Code | iterative | [fable-5-1-max.js](packages/bots/fable-5-1-max.js) | 191.5 | 160.7 – 227.7 | 69.1 | 260 / 5 / 115 |
| 3 | GPT-6 Astra | OpenAI | ultra | Codex | iterative | [gpt-6-astra-ultra.js](packages/bots/gpt-6-astra-ultra.js) | 177.0 | 150.1 – 210.3 | 67.2 | 249 / 13 / 118 |
| 4 | GPT-6.1 Sol | OpenAI | ultra | Codex | iterative | [gpt-6-1-sol-ultra.js](packages/bots/gpt-6-1-sol-ultra.js) | 140.5 | 118.7 – 165.9 | 61.6 | 215 / 38 / 127 |
| 5 | GPT-5.6 Terra | OpenAI | ultra | Codex | iterative | [gpt-5-6-terra-ultra.js](packages/bots/gpt-5-6-terra-ultra.js) | 133.3 | 110.1 – 161.8 | 60.3 | 216 / 26 / 138 |
| 6 | Claude Sonnet 5 | Anthropic | max | Claude Code | iterative | [sonnet-5-max.js](packages/bots/sonnet-5-max.js) | 125.3 | 106.6 – 146.7 | 58.7 | 206 / 34 / 140 |
| 7 | DeepSeek V4 Pro 0813 | DeepSeek | — | OpenCode | iterative | [deepseek-v4-pro-0813.js](packages/bots/deepseek-v4-pro-0813.js) | 100.7 | 84.0 – 119.0 | 53.0 | 186 / 31 / 163 |
| 8 | GPT-5.5 | OpenAI | xhigh | Codex | iterative | [gpt-5-5-xhigh.js](packages/bots/gpt-5-5-xhigh.js) | 96.7 | 83.1 – 110.7 | 52.0 | 173 / 49 / 158 |
| 9 | Claude Opus 5.1 | Anthropic | max | Claude Code | iterative | [opus-5-1-max.js](packages/bots/opus-5-1-max.js) | 90.6 | 76.0 – 105.9 | 50.3 | 181 / 20 / 179 |
| 10 | Claude Haiku 4.5 | Anthropic | max | Claude Code | iterative | [haiku-4-5-max.js](packages/bots/haiku-4-5-max.js) | 87.5 | 72.8 – 105.2 | 49.3 | 171 / 33 / 176 |
| 11 | GPT-6.2 Sol | OpenAI | ultra | Codex | iterative | [gpt-6-2-sol-ultra.js](packages/bots/gpt-6-2-sol-ultra.js) | 87.0 | 74.7 – 102.4 | 49.2 | 167 / 40 / 173 |
| 12 | GLM 5.3 Flash | Z.ai | — | OpenCode | iterative | [glm-5-3-flash.js](packages/bots/glm-5-3-flash.js) | 85.7 | 73.3 – 100.1 | 48.8 | 173 / 25 / 182 |
| 13 | GPT-6 Sol | OpenAI | ultra | Codex | iterative | [gpt-6-sol-ultra.js](packages/bots/gpt-6-sol-ultra.js) | 85.3 | 71.5 – 100.2 | 48.7 | 181 / 8 / 191 |
| 14 | Claude Opus 5.5 | Anthropic | max | Claude Code | iterative | [opus-5-5-max.js](packages/bots/opus-5-5-max.js) | 76.3 | 65.0 – 87.9 | 45.8 | 163 / 22 / 195 |
| 15 | GPT-6.1 Terra | OpenAI | ultra | Codex | iterative | [gpt-6-1-terra-ultra.js](packages/bots/gpt-6-1-terra-ultra.js) | 73.7 | 60.4 – 88.1 | 44.9 | 152 / 37 / 191 |
| 16 | GPT-5.6 Sol | OpenAI | ultra | Codex | iterative | [gpt-5-6-sol-ultra.js](packages/bots/gpt-5-6-sol-ultra.js) | 73.3 | 62.6 – 84.7 | 44.7 | 150 / 40 / 190 |
| 17 | GPT-5.6 Luna | OpenAI | max | Codex | iterative | [gpt-5-6-luna-max.js](packages/bots/gpt-5-6-luna-max.js) | 61.9 | 51.9 – 72.9 | 40.4 | 138 / 31 / 211 |
| 18 | GPT-6 Luna | OpenAI | max | Codex | iterative | [gpt-6-luna-max.js](packages/bots/gpt-6-luna-max.js) | 48.0 | 39.5 – 57.8 | 34.1 | 114 / 31 / 235 |
| 19 | Baseline | Reference controller | — | — | reference | [baseline.js](packages/bots/baseline.js) | 34.3 | 28.0 – 41.6 | 26.4 | 78 / 45 / 257 |
| 20 | GPT-5.3 Codex Spark | OpenAI | xhigh | Codex | iterative | [gpt-5-3-codex-spark-xhigh.js](packages/bots/gpt-5-3-codex-spark-xhigh.js) | 33.1 | 26.5 – 40.0 | 25.7 | 80 / 35 / 265 |

**Play style.** Measured from the recorded frames of the same matches. The profile names the axis where a controller stands out most against this roster.

| Controller | Profile | Contact | Closing | Wedge | Engagements / min | Speed | Turn rate | Edge time | Energy / s | Recharges |
|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.2 Astra | Energy burn | 32% | 49% | 78% | 7.9 | 1.32 m/s | 0.40 rad/s | 6% | 15.3 | 2.7 |
| Fable 5.1 | Wedge control | 16% | 37% | 68% | 9.0 | 0.88 m/s | 0.63 rad/s | 26% | 9.4 | 1.7 |
| GPT-6 Astra | Energy burn | 24% | 40% | 65% | 7.3 | 1.16 m/s | 0.56 rad/s | 4% | 13.2 | 3.6 |
| GPT-6.1 Sol | Wedge control | 34% | 38% | 88% | 4.7 | 0.85 m/s | 0.27 rad/s | 7% | 13.1 | 1.4 |
| GPT-5.6 Terra | Aggression | 26% | 41% | 66% | 5.9 | 0.89 m/s | 0.54 rad/s | 5% | 11.1 | 2.3 |
| Claude Sonnet 5 | Pressure | 30% | 41% | 59% | 6.5 | 0.65 m/s | 0.51 rad/s | 4% | 10.9 | 1.0 |
| DeepSeek V4 Pro 0813 | Aggression | 26% | 44% | 61% | 7.7 | 1.28 m/s | 0.78 rad/s | 7% | 11.7 | 1.5 |
| GPT-5.5 | Wedge control | 37% | 48% | 90% | 4.8 | 0.93 m/s | 0.24 rad/s | 11% | 14.5 | 0.3 |
| Claude Opus 5.1 | Mobility | 15% | 28% | 51% | 7.4 | 1.60 m/s | 0.83 rad/s | 7% | 9.0 | 2.0 |
| Claude Haiku 4.5 | Energy burn | 32% | 43% | 75% | 6.7 | 1.17 m/s | 0.52 rad/s | 7% | 13.6 | 1.5 |
| GPT-6.2 Sol | Edge play | 25% | 12% | 73% | 4.7 | 0.26 m/s | 0.26 rad/s | 38% | 8.3 | 0.8 |
| GLM 5.3 Flash | Pressure | 27% | 33% | 53% | 6.9 | 0.96 m/s | 0.67 rad/s | 14% | 11.3 | 0.9 |
| GPT-6 Sol | Mobility | 15% | 25% | 22% | 3.9 | 2.14 m/s | 0.88 rad/s | 6% | 9.2 | 5.9 |
| Claude Opus 5.5 | Pressure | 20% | 30% | 56% | 6.8 | 0.96 m/s | 0.52 rad/s | 10% | 10.6 | 1.9 |
| GPT-6.1 Terra | Wedge control | 32% | 46% | 88% | 4.9 | 0.96 m/s | 0.27 rad/s | 12% | 13.8 | 0.4 |
| GPT-5.6 Sol | Pressure | 34% | 42% | 66% | 5.4 | 0.78 m/s | 0.44 rad/s | 7% | 12.5 | 1.1 |
| GPT-5.6 Luna | Pressure | 28% | 42% | 72% | 5.0 | 0.84 m/s | 0.49 rad/s | 1% | 11.1 | 0.9 |
| GPT-6 Luna | Aggression | 24% | 53% | 52% | 6.2 | 1.24 m/s | 0.71 rad/s | 3% | 11.1 | 1.3 |
| Baseline | Pressure | 33% | 45% | 85% | 3.9 | 0.88 m/s | 0.29 rad/s | 8% | 13.3 | 0.3 |
| GPT-5.3 Codex Spark | Pressure | 33% | 44% | 69% | 5.4 | 1.16 m/s | 0.45 rad/s | 11% | 12.0 | 0.5 |

**Highlights.** The matches worth watching: total flips first, then engagements. Each link simulates the match again in the arena.

| Match | Seed / spawn | Flips | Engagements | Result | Watch |
|---|---|---|---|---|---|
| GPT-6 Astra vs Fable 5.1 | 4 / mirrored | 3 | 5 | GPT-6 Astra wins, flips at 59 s | [simulate](https://llms-robot-arena.sndesign.it/?a=gpt-6-astra-ultra&b=fable-5-1-max&seed=4&spawn=mirror) |
| Fable 5.1 vs GPT-6 Luna | 8 / mirrored | 2 | 17 | GPT-6 Luna wins, ring-out at 69 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=gpt-6-luna-max&seed=8&spawn=mirror) |
| Fable 5.1 vs GPT-6 Luna | 8 / standard | 2 | 15 | Fable 5.1 wins, flips at 45 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=gpt-6-luna-max&seed=8&spawn=normal) |
| Fable 5.1 vs GPT-6 Sol | 0 / standard | 2 | 14 | Fable 5.1 wins, flips at 87 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=gpt-6-sol-ultra&seed=0&spawn=normal) |
| Fable 5.1 vs GPT-6 Sol | 6 / mirrored | 2 | 14 | Fable 5.1 wins, flips at 101 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=gpt-6-sol-ultra&seed=6&spawn=mirror) |

**Implementation.** Measured from the submitted source: cyclomatic complexity counts branches and short-circuit operators, nesting counts functions and control statements.

| Controller | Language | Lines | Code | Comments | Functions | Cyclomatic | Max nesting | Size |
|---|---|---|---|---|---|---|---|---|
| GPT-6.2 Astra | js | 156 | 138 | 9 | 4 | 56 | 4 | 6.1 kB |
| Fable 5.1 | js | 591 | 490 | 102 | 15 | 518 | 13 | 35.4 kB |
| GPT-6 Astra | js | 246 | 221 | 17 | 9 | 181 | 6 | 12.8 kB |
| GPT-6.1 Sol | js | 304 | 285 | 4 | 7 | 144 | 6 | 11.2 kB |
| GPT-5.6 Terra | js | 459 | 423 | 4 | 7 | 164 | 8 | 15.4 kB |
| Claude Sonnet 5 | js | 383 | 296 | 70 | 7 | 191 | 8 | 19.5 kB |
| DeepSeek V4 Pro 0813 | js | 135 | 122 | 0 | 3 | 61 | 7 | 4.4 kB |
| GPT-5.5 | js | 59 | 50 | 0 | 1 | 23 | 4 | 1.5 kB |
| Claude Opus 5.1 | js | 450 | 362 | 69 | 10 | 275 | 7 | 23.4 kB |
| Claude Haiku 4.5 | js | 65 | 54 | 0 | 1 | 26 | 5 | 1.9 kB |
| GPT-6.2 Sol | js | 232 | 210 | 1 | 11 | 109 | 5 | 9.3 kB |
| GLM 5.3 Flash | js | 397 | 348 | 26 | 8 | 152 | 9 | 13.0 kB |
| GPT-6 Sol | js | 263 | 248 | 0 | 5 | 105 | 6 | 8.5 kB |
| Claude Opus 5.5 | js | 443 | 379 | 47 | 5 | 187 | 6 | 15.5 kB |
| GPT-6.1 Terra | js | 55 | 54 | 0 | 3 | 44 | 6 | 2.8 kB |
| GPT-5.6 Sol | js | 609 | 564 | 0 | 10 | 201 | 10 | 19.9 kB |
| GPT-5.6 Luna | js | 306 | 285 | 0 | 5 | 112 | 6 | 9.9 kB |
| GPT-6 Luna | js | 236 | 202 | 0 | 7 | 79 | 5 | 8.2 kB |
| Baseline | js | 18 | 15 | 2 | 1 | 4 | 2 | 0.4 kB |
| GPT-5.3 Codex Spark | js | 173 | 143 | 0 | 1 | 76 | 5 | 4.8 kB |

**Craft index.** One number over results and source: a weighted geometric mean of strength (45%), reliability (20%), consistency (15%), efficiency (10%) and maintainability (10%). Every term is scaled 0 to 1, the first four against this roster and maintainability against ten branches per function and four levels of nesting. It is not the ranking: strength alone decides that.

| Controller | Craft index | Strength | Reliability | Consistency | Efficiency | Maintainability |
|---|---|---|---|---|---|---|
| GPT-6.2 Astra | 95.7 | 1.00 | 1.00 | 0.83 | 1.00 | 0.86 |
| Fable 5.1 | 82.6 | 0.97 | 1.00 | 0.83 | 0.77 | 0.30 |
| GPT-6 Astra | 85.8 | 0.89 | 1.00 | 0.83 | 0.82 | 0.58 |
| GPT-6.1 Sol | 75.1 | 0.71 | 0.99 | 0.83 | 0.62 | 0.58 |
| GPT-5.6 Terra | 70.6 | 0.67 | 0.99 | 0.81 | 0.55 | 0.46 |
| Claude Sonnet 5 | 68.6 | 0.63 | 1.00 | 0.84 | 0.55 | 0.43 |
| DeepSeek V4 Pro 0813 | 62.8 | 0.51 | 0.98 | 0.83 | 0.52 | 0.53 |
| GPT-5.5 | 64.9 | 0.49 | 0.98 | 0.86 | 0.61 | 0.72 |
| Claude Opus 5.1 | 57.6 | 0.46 | 1.00 | 0.83 | 0.38 | 0.47 |
| Claude Haiku 4.5 | 59.6 | 0.44 | 0.97 | 0.81 | 0.54 | 0.59 |
| GPT-6.2 Sol | 60.8 | 0.44 | 1.00 | 0.84 | 0.41 | 0.90 |
| GLM 5.3 Flash | 56.0 | 0.43 | 0.98 | 0.84 | 0.37 | 0.49 |
| GPT-6 Sol | 57.1 | 0.43 | 0.99 | 0.83 | 0.39 | 0.57 |
| Claude Opus 5.5 | 52.5 | 0.39 | 1.00 | 0.85 | 0.32 | 0.47 |
| GPT-6.1 Terra | 55.0 | 0.37 | 0.98 | 0.81 | 0.46 | 0.67 |
| GPT-5.6 Sol | 50.8 | 0.37 | 1.00 | 0.85 | 0.29 | 0.45 |
| GPT-5.6 Luna | 47.4 | 0.31 | 0.97 | 0.83 | 0.27 | 0.56 |
| GPT-6 Luna | 41.6 | 0.24 | 0.82 | 0.81 | 0.22 | 0.84 |
| Baseline | 38.7 | 0.17 | 0.96 | 0.80 | 0.30 | 1.00 |
| GPT-5.3 Codex Spark | 33.1 | 0.17 | 0.95 | 0.80 | 0.17 | 0.47 |

<!-- standings:end -->

## Try it with your own LLM

The quickest way: on the site, press **Connect an assistant** (in the arena or in the Bot Lab). The page shows a session code and a sentence to paste into Claude, ChatGPT, Cursor, Codex or any client that speaks MCP. The assistant connects to `https://live.llms-robot-arena.sndesign.it/mcp`, reads the bot contract, writes a controller, runs the conformity gate and matches against the catalog on the server, then sends the controller to your page. You accept it, it plays Baseline at once, and from there you can watch it, rumble it or fight it from the keyboard. Nothing is stored and no account is needed; opponents stay black boxes, the assistant only sees results.

With a coding agent and Node.js 24 or newer, the full protocol runs locally. Give it this prompt:

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
