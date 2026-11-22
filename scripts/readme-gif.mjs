// npm run readme-gif [-- --seconds 10]
// The README animation: the home match exported as a clip by the built site
// in headless Chrome, then the last seconds of play (without the verdict card)
// turned into a small GIF by ffmpeg.
// Needs `npm run build` first, Chrome and ffmpeg on the PATH.
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { OUTRO_SECONDS } from "../packages/renderer/recorder.js";
import { launchBrowser, startSite } from "../tests/e2e/driver.mjs";

const { values } = parseArgs({ options: { seconds: { type: "string", default: "10" }, out: { type: "string", default: "video.gif" } } });
const seconds = Number(values.seconds);
if (!(seconds > 0)) throw Error("--seconds must be a positive number.");
const out = resolve(fileURLToPath(new URL("../", import.meta.url)), values.out);

const site = await startSite();
const browser = await launchBrowser();
try {
  const page = await browser.page();
  await page.goto(site.url + "/");
  await page.waitFor("document.querySelector('#record') && !document.querySelector('#record').disabled", 120000);
  // A silent clip: no second pass in real time to record the sound.
  if (await page.eval("!document.querySelector('#sound').classList.contains('muted')")) await page.click("#sound");
  await page.click("#record");
  const clip = await (async () => {
    for (let i = 0; i < 1200; i++) {
      const name = (await readdir(browser.downloads).catch(() => [])).find((n) => n.endsWith(".mp4"));
      if (name) return join(browser.downloads, name);
      await page.wait(500);
    }
    throw Error("The clip never arrived.");
  })();
  await page.wait(1000);
  // The seconds before the verdict card, 480 px wide at 15 fps with 64 colors and no dither: about 0.4 MB a second.
  await promisify(execFile)("ffmpeg", [
    "-y", "-sseof", `-${seconds + OUTRO_SECONDS}`, "-t", String(seconds), "-i", clip,
    "-vf", "fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop", "0", out,
  ]);
  console.log(`${out}: the last ${seconds} s of the home match.`);
} finally {
  await browser.close();
  await site.close();
}
