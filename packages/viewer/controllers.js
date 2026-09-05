import { botName } from "../bot-catalog.js";

export function sortedBotOptions(bots) {
  return bots.map((bot, index) => ({ bot, index })).sort((a, b) =>
    botName(a.bot).localeCompare(botName(b.bot), "en", { sensitivity: "base", numeric: true }) ||
    (a.bot.thinking ?? "").localeCompare(b.bot.thinking ?? "", "en") ||
    a.bot.id.localeCompare(b.bot.id, "en"));
}

export function controllerExtension(bot) {
  if (["js", "ts"].includes(bot.extension)) return bot.extension;
  return bot.file?.endsWith(".ts") ? "ts" : "js";
}

export function controllerFilename(name, extension) {
  return (name.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "controller") +
    (extension === "ts" ? ".ts" : ".js");
}
