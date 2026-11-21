import { botName } from "../bot-catalog.js";

export function sortedBotOptions(bots) {
  return bots.map((bot, index) => ({ bot, index })).sort((a, b) =>
    botName(a.bot).localeCompare(botName(b.bot), "en", { sensitivity: "base", numeric: true }) ||
    (a.bot.thinking ?? "").localeCompare(b.bot.thinking ?? "", "en") ||
    a.bot.id.localeCompare(b.bot.id, "en"));
}

// The selectors group the controllers: one group per provider, then the reference
// controller, then the ones written in this tab (Bot Lab or an assistant).
export function groupedBotOptions(bots) {
  const label = (bot) =>
    bot.id.startsWith("custom-") ? "Your controllers" : bot.provenance === "reference" ? "Reference" : bot.provider || "Other";
  const rank = (name) => (name === "Your controllers" ? 2 : name === "Reference" ? 1 : 0);
  const groups = new Map();
  for (const option of sortedBotOptions(bots)) {
    const name = label(option.bot);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(option);
  }
  return [...groups]
    .map(([name, options]) => ({ label: name, options }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

export function controllerFilename(name) {
  return (name.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "controller") + ".js";
}
