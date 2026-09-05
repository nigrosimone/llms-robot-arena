import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { botCatalog, validateBotDefinitions } from "./bot-catalog.js";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function resolveBotDefinitions(entries = botCatalog, directory = projectRoot) {
  if (!Array.isArray(entries)) throw new Error("Bot manifest must be an array.");
  const resolved = entries.map(entry => {
    if (typeof entry === "string") {
      const bot = botCatalog.find(bot => bot.id === entry);
      if (!bot) throw new Error(`Unknown catalog bot: ${entry}`);
      return { ...bot, file: resolve(projectRoot, bot.file) };
    }
    return entry && typeof entry.file === "string"
      ? { ...entry, file: entry.file.trim() ? resolve(directory, entry.file) : "" }
      : entry;
  });
  return validateBotDefinitions(resolved);
}

// Sources are opaque inputs to the standard build and runtime, never diagnostics.
export async function loadBots(manifestPath = null) {
  const entries = manifestPath
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : botCatalog;
  const definitions = resolveBotDefinitions(
    entries, manifestPath ? dirname(resolve(manifestPath)) : projectRoot,
  );
  return Promise.all(definitions.map(async bot => ({
    ...bot,
    source: await readFile(bot.file, "utf8"),
  })));
}
