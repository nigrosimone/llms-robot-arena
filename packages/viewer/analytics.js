// GoatCounter counts pages on load; panel switches and the few actions worth
// measuring are sent by hand. Nothing happens when the script is blocked.
export function track(name, title = name) {
  try {
    globalThis.goatcounter?.count?.({ path: name, title, event: true });
  } catch {}
}
export function trackPage(path) {
  try {
    globalThis.goatcounter?.count?.({ path });
  } catch {}
}
