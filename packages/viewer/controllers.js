export function controllerExtension(bot) {
  if (["js", "ts"].includes(bot.extension)) return bot.extension;
  return bot.file?.endsWith(".ts") ? "ts" : "js";
}

export function controllerFilename(name, extension) {
  return (name.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "controller") +
    (extension === "ts" ? ".ts" : ".js");
}
