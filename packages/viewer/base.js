// Assets live next to the bundle, never next to the page that loaded it: the
// static page at /rules/ still has to reach /standings.json and /replays/.
import { normalizeRoute } from "../site/content.js";

export const siteRoot = new URL("./", import.meta.url);
export const siteUrl = (path) => new URL(path, siteRoot);
export const pagePath = (route) => new URL(route, siteRoot).pathname;
export const currentRoute = () =>
  normalizeRoute(location.pathname.slice(siteRoot.pathname.length));
