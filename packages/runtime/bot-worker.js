import { compileBot } from "./compile.js";
import { createSandbox } from "./sandbox.js";
let sandbox;
export async function handleBotMessage(message) {
  if (message.type === "init") {
    sandbox?.dispose();
    sandbox = await createSandbox(compileBot(message.source), {
      budgetMode: message.budgetMode,
    });
    return { ready: true };
  }
  if (message.type === "tick") {
    if (!sandbox) throw new Error("Bot not initialized.");
    return sandbox.call(message.sensors);
  }
  if (message.type === "probe")
    return sandbox.call(message.sensors, message.memory ?? null);
  if (message.type === "close") {
    sandbox?.dispose();
    sandbox = null;
    return { closed: true };
  }
  throw new Error("Unknown message.");
}
if (typeof self !== "undefined")
  self.onmessage = async (e) => {
    try {
      self.postMessage({
        id: e.data.id,
        result: await handleBotMessage(e.data),
      });
    } catch (error) {
      self.postMessage({ id: e.data.id, error: error.message });
    }
  };
