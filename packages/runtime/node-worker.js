import { parentPort } from "node:worker_threads";
import { handleBotMessage } from "./bot-worker.js";
parentPort.on("message", async (message) => {
  try {
    parentPort.postMessage({
      id: message.id,
      result: await handleBotMessage(message),
    });
  } catch (e) {
    parentPort.postMessage({ id: message.id, error: e.message });
  }
});
