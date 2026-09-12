// npm run live -- --port 8787 --host 0.0.0.0
// The live server for assistants: MCP on /mcp, the browser session on /session.
import { parseArgs } from "node:util";
import { createApp, DEFAULT_ORIGINS } from "../packages/server/app.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: process.env.PORT ?? "8787" },
    host: { type: "string", default: process.env.HOST ?? "127.0.0.1" },
    // Comma separated site origins allowed to open a session; the site itself by default.
    origins: { type: "string", default: process.env.ARENA_ORIGINS ?? "" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log("npm run live -- --port 8787 --host 127.0.0.1 --origins https://example.org,http://localhost:4200");
  process.exit(0);
}
const origins = values.origins ? values.origins.split(",").map((o) => o.trim()).filter(Boolean) : DEFAULT_ORIGINS;
const server = await createApp({ origins, log: (line) => console.log(new Date().toISOString(), line) });
const port = await server.listen(Number(values.port), values.host);
console.log(`llms-robot-arena live server: http://${values.host}:${port} (MCP on /mcp, sessions on /session)`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
