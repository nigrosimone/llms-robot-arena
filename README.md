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

Round robin (10 seeds per pair, mirrored spawns) · 1820 matches · fuel budget · spec 0.2.2-draft / engine 0.2.2-r2 · generated 2026-09-23.

| # | Controller | Provider | Thinking | Harness | Development | Source | Strength | 95% CI | Score % | W / D / L |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GPT-6 Astra | OpenAI | ultra | Codex | iterative | [gpt-6-astra-ultra.js](packages/bots/gpt-6-astra-ultra.js) | 229.6 | 184.5 – 287.8 | 74.2 | 189 / 8 / 63 |
| 2 | Fable 5.1 | Anthropic | max | Claude Code | iterative | [fable-5-1-max.js](packages/bots/fable-5-1-max.js) | 210.6 | 171.5 – 260.8 | 72.3 | 186 / 4 / 70 |
| 3 | GPT-5.6 Terra | OpenAI | ultra | Codex | iterative | [gpt-5-6-terra-ultra.js](packages/bots/gpt-5-6-terra-ultra.js) | 131.6 | 107.5 – 161.3 | 61.0 | 149 / 19 / 92 |
| 4 | Claude Sonnet 5 | Anthropic | max | Claude Code | iterative | [sonnet-5-max.js](packages/bots/sonnet-5-max.js) | 117.6 | 95.5 – 142.3 | 58.1 | 142 / 18 / 100 |
| 5 | Claude Opus 5.1 | Anthropic | max | Claude Code | iterative | [opus-5-1-max.js](packages/bots/opus-5-1-max.js) | 99.3 | 81.2 – 119.0 | 53.7 | 132 / 15 / 113 |
| 6 | DeepSeek V4 Pro 0813 | DeepSeek | — | OpenCode | iterative | [deepseek-v4-pro-0813.js](packages/bots/deepseek-v4-pro-0813.js) | 95.1 | 78.8 – 113.3 | 52.5 | 125 / 23 / 112 |
| 7 | Claude Haiku 4.5 | Anthropic | max | Claude Code | iterative | [haiku-4-5-max.js](packages/bots/haiku-4-5-max.js) | 89.0 | 71.4 – 108.0 | 50.8 | 119 / 26 / 115 |
| 8 | GPT-5.5 | OpenAI | xhigh | Codex | iterative | [gpt-5-5-xhigh.js](packages/bots/gpt-5-5-xhigh.js) | 84.6 | 68.9 – 101.2 | 49.4 | 115 / 27 / 118 |
| 9 | Claude Opus 5.5 | Anthropic | max | Claude Code | iterative | [opus-5-5-max.js](packages/bots/opus-5-5-max.js) | 80.4 | 66.5 – 96.9 | 48.1 | 117 / 16 / 127 |
| 10 | GPT-5.6 Sol | OpenAI | ultra | Codex | iterative | [gpt-5-6-sol-ultra.js](packages/bots/gpt-5-6-sol-ultra.js) | 69.0 | 56.1 – 82.7 | 44.0 | 99 / 31 / 130 |
| 11 | GLM 5.3 Flash | Z.ai | — | OpenCode | iterative | [glm-5-3-flash.js](packages/bots/glm-5-3-flash.js) | 67.5 | 54.9 – 80.8 | 43.5 | 103 / 20 / 137 |
| 12 | GPT-5.6 Luna | OpenAI | max | Codex | iterative | [gpt-5-6-luna-max.js](packages/bots/gpt-5-6-luna-max.js) | 59.0 | 47.8 – 71.7 | 40.0 | 93 / 22 / 145 |
| 13 | Baseline | Reference controller | — | — | reference | [baseline.js](packages/bots/baseline.js) | 34.3 | 27.2 – 42.1 | 26.9 | 59 / 22 / 179 |
| 14 | GPT-5.3 Codex Spark | OpenAI | xhigh | Codex | iterative | [gpt-5-3-codex-spark-xhigh.js](packages/bots/gpt-5-3-codex-spark-xhigh.js) | 32.3 | 24.7 – 41.0 | 25.6 | 54 / 25 / 181 |

**Play style.** Measured from the recorded frames of the same matches. The profile names the axis where a controller stands out most against this roster.

| Controller | Profile | Contact | Closing | Wedge | Engagements / min | Speed | Turn rate | Edge time | Energy / s | Recharges |
|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | Energy burn | 25% | 42% | 68% | 7.5 | 1.19 m/s | 0.59 rad/s | 4% | 13.5 | 3.9 |
| Fable 5.1 | Edge play | 15% | 38% | 67% | 9.5 | 0.89 m/s | 0.66 rad/s | 26% | 9.3 | 1.6 |
| GPT-5.6 Terra | Aggression | 27% | 39% | 67% | 5.7 | 0.83 m/s | 0.52 rad/s | 5% | 11.3 | 2.3 |
| Claude Sonnet 5 | Aggression | 29% | 40% | 56% | 6.8 | 0.67 m/s | 0.55 rad/s | 3% | 11.0 | 1.0 |
| Claude Opus 5.1 | Mobility | 16% | 26% | 50% | 7.6 | 1.60 m/s | 0.85 rad/s | 6% | 9.1 | 2.1 |
| DeepSeek V4 Pro 0813 | Aggression | 26% | 44% | 62% | 7.9 | 1.24 m/s | 0.81 rad/s | 5% | 11.6 | 1.6 |
| Claude Haiku 4.5 | Energy burn | 33% | 44% | 78% | 7.5 | 1.15 m/s | 0.52 rad/s | 6% | 13.8 | 1.5 |
| GPT-5.5 | Aggression | 35% | 47% | 89% | 5.0 | 0.90 m/s | 0.24 rad/s | 8% | 13.9 | 0.3 |
| Claude Opus 5.5 | Energy burn | 21% | 26% | 51% | 7.4 | 0.96 m/s | 0.51 rad/s | 10% | 10.7 | 1.6 |
| GPT-5.6 Sol | Pressure | 34% | 40% | 67% | 5.1 | 0.66 m/s | 0.42 rad/s | 5% | 12.5 | 1.1 |
| GLM 5.3 Flash | Energy burn | 27% | 31% | 45% | 7.4 | 0.95 m/s | 0.67 rad/s | 12% | 11.5 | 0.9 |
| GPT-5.6 Luna | Aggression | 29% | 40% | 72% | 5.2 | 0.79 m/s | 0.52 rad/s | 1% | 11.3 | 0.9 |
| Baseline | Pressure | 33% | 45% | 87% | 4.4 | 0.86 m/s | 0.30 rad/s | 6% | 13.3 | 0.3 |
| GPT-5.3 Codex Spark | Pressure | 32% | 44% | 68% | 5.9 | 1.17 m/s | 0.46 rad/s | 9% | 11.8 | 0.6 |

**Highlights.** The matches worth watching: total flips first, then engagements. Each link simulates the match again in the arena.

| Match | Seed / spawn | Flips | Engagements | Result | Watch |
|---|---|---|---|---|---|
| GPT-6 Astra vs Fable 5.1 | 4 / mirrored | 3 | 5 | GPT-6 Astra wins, flips at 59 s | [simulate](https://llms-robot-arena.sndesign.it/?a=gpt-6-astra-ultra&b=fable-5-1-max&seed=4&spawn=mirror) |
| Fable 5.1 vs Claude Opus 5.1 | 1 / mirrored | 2 | 12 | Claude Opus 5.1 wins, flips at 62 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=opus-5-1-max&seed=1&spawn=mirror) |
| Fable 5.1 vs Claude Opus 5.5 | 3 / mirrored | 2 | 12 | Fable 5.1 wins, ring-out at 79 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=opus-5-5-max&seed=3&spawn=mirror) |
| GPT-5.6 Sol vs Claude Opus 5.5 | 7 / mirrored | 2 | 11 | Claude Opus 5.5 wins, hole at 72 s | [simulate](https://llms-robot-arena.sndesign.it/?a=gpt-5-6-sol-ultra&b=opus-5-5-max&seed=7&spawn=mirror) |
| Fable 5.1 vs Claude Haiku 4.5 | 5 / mirrored | 2 | 11 | Fable 5.1 wins, hole at 32 s | [simulate](https://llms-robot-arena.sndesign.it/?a=fable-5-1-max&b=haiku-4-5-max&seed=5&spawn=mirror) |

**Implementation.** Measured from the submitted source: cyclomatic complexity counts branches and short-circuit operators, nesting counts functions and control statements.

| Controller | Language | Lines | Code | Comments | Functions | Cyclomatic | Max nesting | Size |
|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | js | 246 | 221 | 17 | 9 | 181 | 6 | 12.8 kB |
| Fable 5.1 | js | 591 | 490 | 102 | 15 | 518 | 13 | 35.4 kB |
| GPT-5.6 Terra | js | 459 | 423 | 4 | 7 | 164 | 8 | 15.4 kB |
| Claude Sonnet 5 | js | 383 | 296 | 70 | 7 | 191 | 8 | 19.5 kB |
| Claude Opus 5.1 | js | 450 | 362 | 69 | 10 | 275 | 7 | 23.4 kB |
| DeepSeek V4 Pro 0813 | js | 135 | 122 | 0 | 3 | 61 | 7 | 4.4 kB |
| Claude Haiku 4.5 | js | 65 | 54 | 0 | 1 | 26 | 5 | 1.9 kB |
| GPT-5.5 | js | 59 | 50 | 0 | 1 | 23 | 4 | 1.5 kB |
| Claude Opus 5.5 | js | 443 | 379 | 47 | 5 | 187 | 6 | 15.5 kB |
| GPT-5.6 Sol | js | 609 | 564 | 0 | 10 | 201 | 10 | 19.9 kB |
| GLM 5.3 Flash | js | 397 | 348 | 26 | 8 | 152 | 9 | 13.0 kB |
| GPT-5.6 Luna | js | 306 | 285 | 0 | 5 | 112 | 6 | 9.9 kB |
| Baseline | js | 18 | 15 | 2 | 1 | 4 | 2 | 0.4 kB |
| GPT-5.3 Codex Spark | js | 173 | 143 | 0 | 1 | 76 | 5 | 4.8 kB |

**Craft index.** One number over results and source: a weighted geometric mean of strength (45%), reliability (20%), consistency (15%), efficiency (10%) and maintainability (10%). Every term is scaled 0 to 1, the first four against this roster and maintainability against ten branches per function and four levels of nesting. It is not the ranking: strength alone decides that.

| Controller | Craft index | Strength | Reliability | Consistency | Efficiency | Maintainability |
|---|---|---|---|---|---|---|
| GPT-6 Astra | 91.2 | 1.00 | 1.00 | 0.78 | 1.00 | 0.58 |
| Fable 5.1 | 80.4 | 0.92 | 1.00 | 0.79 | 0.80 | 0.30 |
| GPT-5.6 Terra | 65.0 | 0.57 | 0.99 | 0.80 | 0.51 | 0.46 |
| Claude Sonnet 5 | 61.2 | 0.51 | 1.00 | 0.80 | 0.49 | 0.43 |
| Claude Opus 5.1 | 56.1 | 0.43 | 1.00 | 0.81 | 0.40 | 0.47 |
| DeepSeek V4 Pro 0813 | 56.5 | 0.41 | 0.98 | 0.82 | 0.46 | 0.53 |
| Claude Haiku 4.5 | 55.8 | 0.39 | 0.98 | 0.79 | 0.52 | 0.59 |
| GPT-5.5 | 55.6 | 0.37 | 0.98 | 0.81 | 0.50 | 0.72 |
| Claude Opus 5.5 | 50.0 | 0.35 | 1.00 | 0.81 | 0.32 | 0.47 |
| GPT-5.6 Sol | 45.4 | 0.30 | 1.00 | 0.81 | 0.26 | 0.45 |
| GLM 5.3 Flash | 45.4 | 0.29 | 0.98 | 0.81 | 0.27 | 0.49 |
| GPT-5.6 Luna | 42.8 | 0.26 | 0.98 | 0.80 | 0.25 | 0.56 |
| Baseline | 36.0 | 0.15 | 0.98 | 0.78 | 0.29 | 1.00 |
| GPT-5.3 Codex Spark | 30.2 | 0.14 | 0.97 | 0.75 | 0.15 | 0.47 |

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
