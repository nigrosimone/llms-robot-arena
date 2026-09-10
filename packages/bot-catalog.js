import definitions from "../bots.json" with { type: "json" };

export function validateBotDefinitions(entries, { catalog = false } = {}) {
  if (!Array.isArray(entries) || entries.length < 2)
    throw new Error("At least two bot definitions are required.");
  const ids = new Set();
  const files = new Set();
  for (const bot of entries) {
    if (!bot || ["id", "model", "file"].some(
      key => typeof bot[key] !== "string" || !bot[key].trim(),
    )) throw new Error("Each bot needs a non-empty id, model and file.");
    if (ids.has(bot.id)) throw new Error("Bot IDs must be unique.");
    ids.add(bot.id);
    if ((catalog && !Object.hasOwn(bot, "provider")) ||
        (bot.provider != null && (typeof bot.provider !== "string" || !bot.provider.trim())))
      throw new Error("Bot provider must be a non-empty name or null.");
    if (bot.provenance != null &&
        (typeof bot.provenance !== "string" || !bot.provenance.trim()))
      throw new Error("Bot provenance must be a non-empty string.");
    for (const key of ["thinking", "harness"]) {
      if ((catalog && !Object.hasOwn(bot, key)) ||
          (bot[key] != null && (typeof bot[key] !== "string" || !bot[key].trim())))
        throw new Error(`Bot ${key} must be a non-empty string or null.`);
    }
    if (catalog) {
      if (!/^packages\/bots\/[a-zA-Z0-9_-]+\.js$/.test(bot.file))
        throw new Error("Catalog files must be JS files directly in packages/bots/.");
      if (files.has(bot.file.toLowerCase())) throw new Error("Catalog bot files must be unique.");
      files.add(bot.file.toLowerCase());
    }
  }
  return entries;
}

export const botCatalog = Object.freeze(
  validateBotDefinitions(definitions, { catalog: true }).map(bot => Object.freeze({ ...bot })),
);
const byId = new Map(botCatalog.map(bot => [bot.id, bot]));

// Older replays did not separate model names, provider and development provenance.
// New exports retain their recorded metadata, even after the catalog changes.
function displayMetadata(bot) {
  return !Object.hasOwn(bot, "provider") ? byId.get(bot.id) ?? bot : bot;
}

export function botName(bot) {
  const model = displayMetadata(bot).model;
  return typeof model === "string" && model.trim()
    ? (Object.hasOwn(bot, "provider") ? model : model.split(" · ")[0]).trim()
    : "Unnamed controller";
}

export function botProvider(bot) {
  const metadata = displayMetadata(bot);
  return metadata.provider ||
    (metadata.provenance === "reference" ? "Reference controller" : "Provider not specified");
}

export function botMetadata(bot) {
  return {
    id: bot.id,
    model: bot.model ?? "Local controller",
    provider: bot.provider ?? null,
    thinking: bot.thinking ?? null,
    harness: bot.harness ?? null,
    ...(bot.provenance == null ? {} : { provenance: bot.provenance }),
  };
}

export function botDetails(bot) {
  const metadata = displayMetadata(bot);
  return [botProvider(bot), metadata.thinking && `Thinking: ${metadata.thinking}`, metadata.harness]
    .filter(Boolean).join(" · ");
}
