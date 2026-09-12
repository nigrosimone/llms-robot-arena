// The MCP surface an assistant sees: the contract and the opponents as
// resources, the gate, a match, a series and the push as tools, and one
// prompt that walks through the loop. Every tool needs the session code shown
// in the visitor's browser.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { botName, botProvider } from "../bot-catalog.js";
import { MAX_SERIES, SOURCE_LIMIT } from "./work.js";

export const ASSISTANT_BOT = Object.freeze({
  id: "assistant",
  model: "Assistant controller",
  provider: null,
  provenance: "iterative",
  harness: "mcp",
});
const session = z
  .string()
  .min(4)
  .max(12)
  .describe('The session code shown in the browser after "Connect an assistant".');
const source = z
  .string()
  .max(SOURCE_LIMIT)
  .describe("The whole controller file: JavaScript exporting one function tick(sensors, memory).");
const opponent = z
  .string()
  .default("Baseline")
  .describe('Opponent id from arena://opponents; "Baseline" is the reference controller.');
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const failure = (error) => ({ isError: true, content: [{ type: "text", text: error.message }] });

export function createMcpServer({ sessions, work, catalog, contract, standings = null, onActivity = () => {} }) {
  const server = new McpServer({ name: "llms-robot-arena", version: "1.0.0" });
  const find = (id) => {
    const bot = catalog.find((b) => b.id === id || botName(b) === id);
    if (!bot) throw new Error(`Unknown opponent "${id}". Read arena://opponents for the ids.`);
    return bot;
  };
  const rank = new Map((standings?.ranking ?? []).map((row, i) => [row.id, i + 1]));
  const activity = (code, kind, summary) => {
    onActivity(code, kind, summary);
    sessions.emit(code, { type: "activity", kind, summary });
  };

  server.registerResource(
    "contract",
    "arena://contract",
    {
      title: "Bot contract",
      description: "Rules of the arena, the controller contract and the conformity checks: read it before writing.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: contract }] }),
  );
  server.registerResource(
    "opponents",
    "arena://opponents",
    {
      title: "Opponents",
      description: "The registered controllers you can play against: id, model, provider and standing. Their code is never shown.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            catalog.map((b) => ({
              id: b.id,
              name: botName(b),
              provider: botProvider(b),
              ...(b.provenance === "reference" ? { reference: true } : {}),
              ...(rank.has(b.id) ? { standing: rank.get(b.id) } : {}),
            })),
            null,
            1,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "gate",
    {
      title: "Conformity gate",
      description:
        "Runs the conformity checks on a controller source: compilation, isolated scope, purity, inert ticks, memory limits and timing. Returns every check; fix the failed ones before playing.",
      inputSchema: { session, source },
    },
    async ({ session: code, source }) => {
      try {
        sessions.spend(code);
        const verdict = await work.gate(source);
        activity(code, "gate", `Gate ${verdict.pass ? "passed" : verdict.eligible ? "passed with timing advisory" : "failed"}`);
        return text(verdict);
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "match",
    {
      title: "Play one match",
      description:
        "Plays one match of your controller against a registered opponent and returns the outcome, the final energies, the flips and the notable events. Same seed and spawn, same match.",
      inputSchema: {
        session,
        source,
        opponent,
        seed: z.number().int().min(0).max(4294967295).default(0).describe("Match seed: spawn jitter and terrain."),
        spawn: z.enum(["normal", "mirror"]).default("normal").describe("Which side each robot starts from."),
      },
    },
    async ({ session: code, source, opponent: id, seed, spawn }) => {
      try {
        const bot = find(id);
        sessions.spend(code, 1);
        const result = await work.match({ source, bot: ASSISTANT_BOT, opponent: bot, seed, mirrored: spawn === "mirror" });
        activity(code, "match", `Match vs ${botName(bot)}, seed ${seed}: ${result.outcome} by ${result.reason} at ${result.seconds}s`);
        return text(result);
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "series",
    {
      title: "Play a series",
      description: `Plays up to ${MAX_SERIES} matches against one opponent over consecutive seeds, alternating the spawn side, and returns wins, draws and losses with one line per match.`,
      inputSchema: {
        session,
        source,
        opponent,
        matches: z.number().int().min(1).max(MAX_SERIES).default(10).describe("How many matches to play."),
      },
    },
    async ({ session: code, source, opponent: id, matches }) => {
      try {
        const bot = find(id);
        sessions.spend(code, matches);
        const result = await work.series({ source, bot: ASSISTANT_BOT, opponent: bot, matches });
        activity(code, "series", `Series vs ${botName(bot)}: ${result.wins} wins, ${result.draws} draws, ${result.losses} losses`);
        return text(result);
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "push",
    {
      title: "Send the controller to the browser",
      description:
        "Offers the controller to the visitor's open arena: it passes the gate here first, then the visitor accepts or rejects it in the page. Accepted controllers appear in the Bot Lab and start a match against Baseline.",
      inputSchema: {
        session,
        source,
        name: z.string().min(1).max(60).describe("A short name for the controller, shown on its card."),
        model: z.string().max(80).optional().describe("The model that wrote it, if you know."),
      },
    },
    async ({ session: code, source, name, model }) => {
      try {
        sessions.spend(code);
        const gate = await work.gate(source);
        if (!gate.eligible)
          return failure(
            new Error(
              `Not sent: the gate refused it (${gate.checks
                .filter((c) => !c.pass && c.required !== false)
                .map((c) => c.name)
                .join(", ")}). Fix the checks and push again.`,
            ),
          );
        activity(code, "push", `Controller "${name}" offered to the page`);
        const { id, decision } = await sessions.propose(code, { name, model: model ?? null, source, gate });
        return text({
          id,
          decision,
          note:
            decision === "accepted"
              ? "The visitor accepted it: it is in their Bot Lab and a match against Baseline is starting."
              : decision === "rejected"
                ? "The visitor rejected it."
                : "The visitor has not answered yet; they can still accept it from the page.",
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerPrompt(
    "write-controller",
    {
      title: "Write a controller",
      description: "The loop: read the contract, write, gate, play, iterate, push.",
      argsSchema: { session: session.optional() },
    },
    ({ session: code }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `You are building a controller for llms-robot-arena${code ? ` in session ${code}` : ""}.`,
              "1. Read arena://contract in full and arena://opponents.",
              "2. Write one JavaScript file exporting tick(sensors, memory), following the contract.",
              "3. Call gate until every check passes.",
              "4. Call series against Baseline (10 matches); read the outcomes and the events, improve the controller, repeat until it wins more than it loses. Try one or two stronger opponents with match.",
              "5. Call push with a short name. The visitor accepts it in the page.",
              "Never ask for another controller's code: opponents are black boxes.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  return server;
}
