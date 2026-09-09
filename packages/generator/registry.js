import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateBotDefinitions } from "../bot-catalog.js";
import { projectRoot } from "../bot-catalog-node.js";

export const catalogPath = resolve(projectRoot, "bots.json");

// Registration touches one entry only; the rest of the catalog is preserved.
export function mergeCatalogEntry(catalog, entry) {
  if (!Array.isArray(catalog)) throw new Error("The catalog must be an array.");
  const known = catalog.some(bot => bot.id === entry.id);
  const conflict = catalog.find(
    bot => bot.id !== entry.id && bot.file.toLowerCase() === entry.file.toLowerCase(),
  );
  if (conflict) throw new Error(`${entry.file} already belongs to bot "${conflict.id}".`);
  const next = known ? catalog.map(bot => (bot.id === entry.id ? entry : bot)) : [...catalog, entry];
  validateBotDefinitions(next, { catalog: true });
  return next;
}

export function catalogEntry({ id, model, thinking = null, harness = null, provider = null, file, provenance }) {
  return { id, model, thinking, harness, provider, file, provenance };
}

export async function registerBot(entry, { path = catalogPath } = {}) {
  const next = mergeCatalogEntry(JSON.parse(await readFile(path, "utf8")), entry);
  await writeFile(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}
