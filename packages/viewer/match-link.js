const SEED_MAX = 4294967295;

// Match settings travel in the query string, so a single simulation can be shared as a link.
export function readMatchSettings(search, bots) {
  const params = new URLSearchParams(search);
  const controller = (key) => {
    const id = params.get(key);
    if (id === null) return null;
    const index = bots.findIndex((bot) => bot.id === id);
    if (index < 0) throw Error(`Unknown controller "${id}".`);
    return index;
  };
  const settings = { a: controller("a"), b: controller("b"), seed: null, spawn: null };
  const seed = params.get("seed");
  if (seed !== null) {
    if (!/^\d{1,10}$/.test(seed) || Number(seed) > SEED_MAX)
      throw Error("The seed must be an integer between 0 and " + SEED_MAX + ".");
    settings.seed = Number(seed);
  }
  const spawn = params.get("spawn");
  if (spawn !== null) {
    if (spawn !== "normal" && spawn !== "mirror")
      throw Error('The spawn must be "normal" or "mirror".');
    settings.spawn = spawn;
  }
  return Object.values(settings).every((value) => value === null) ? null : settings;
}

export function matchSettingsSearch({ a, b, seed, mirrored }) {
  return "?" + new URLSearchParams({
    a, b, seed: String(seed), spawn: mirrored ? "mirror" : "normal",
  });
}
