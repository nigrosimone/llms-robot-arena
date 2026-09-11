// The viewer as a visitor uses it: these scenarios define the parity a new
// front end has to reach. Run `npm run build` first, then `npm run e2e`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { launchBrowser, startSite } from "./driver.mjs";
import { loadBots } from "../../packages/bot-catalog-node.js";
import { BotClient } from "../../packages/runtime/client.js";
import { runLiveMatch } from "../../packages/runtime/live-match.js";
import { challengeFromReplay, encodeChallenge } from "../../packages/viewer/challenge-link.js";

const SIMULATION = 240000;
let site, browser;
before(async () => {
  site = await startSite();
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await site?.close();
});
const loaded = (page, timeout = SIMULATION) => page.waitFor("document.querySelector('#stage-loading').hidden === true", timeout);
const ended = async (page, timeout = SIMULATION) => {
  await page.set("#speed", "8");
  await page.waitFor("document.querySelector('#result-banner').hidden === false", timeout);
};
const clean = (page) => assert.deepEqual(page.logs, [], "no page errors");

test("the opening match simulates, plays to a verdict, exports and imports its replay", async () => {
  const page = await browser.page();
  await page.goto(site.url + "/");
  await loaded(page);
  assert.equal(await page.eval("location.search"), "?a=gpt-6-astra-ultra&b=fable-5-1-max&seed=0&spawn=normal");
  assert.equal(await page.text("#current-mode"), "Local exhibition");
  assert.equal(await page.eval("document.querySelectorAll('.robot-card').length"), 2);
  await ended(page);
  assert.match(await page.text("#result-title"), /wins\.|Draw\./);
  assert.match(await page.text("#hash-label"), /^SHA-256 [a-f0-9]{12}/);
  await page.click("#export-replay");
  const file = await (async () => {
    for (let i = 0; i < 40; i++) {
      const names = await readdir(browser.downloads).catch(() => []);
      const name = names.find((n) => n.endsWith(".json"));
      if (name) return join(browser.downloads, name);
      await page.wait(250);
    }
    throw Error("the exported replay never arrived");
  })();
  const replay = JSON.parse(await readFile(file, "utf8"));
  assert.equal(replay.mode, "exhibition");
  assert.equal(replay.engineVersion, await page.eval("document.querySelector('.footer').textContent.match(/ENGINE ([0-9][0-9a-z.-]*)/)[1]"));
  await page.setFiles("#replay-file", [file]);
  await page.waitFor("document.querySelector('#toast').textContent.includes('Replay imported')");
  clean(page);
  await page.close();
});

test("a match link applies its settings and a rumble draws twelve from the seed", async () => {
  const page = await browser.page();
  await page.goto(site.url + "/?a=fable-5-1-max&b=haiku-4-5-max&seed=5&spawn=mirror");
  await loaded(page);
  assert.equal(await page.eval("document.querySelector('#seed').value"), "5");
  assert.equal(await page.eval("document.querySelector('#spawn').value"), "mirror");
  assert.equal(await page.text("#robot-name-0"), "Fable 5.1");
  assert.equal(await page.text("#robot-name-1"), "Claude Haiku 4.5");
  assert.match(await page.text("#replay-seed"), /SEED 05 · M/);
  await ended(page);
  assert.equal(await page.hidden("#copy-challenge"), true, "an exhibition is not a challenge");
  await page.set("#seed", "7");
  await page.click("#rumble");
  await page.waitFor("document.querySelector('#toast').textContent.includes('draws 12')");
  await page.click("#cancel");
  await page.waitFor("document.querySelector('#toast').textContent.includes('canceled')");
  clean(page);
  await page.close();
});

test("a challenge link rebuilds the match, can be beaten from the keyboard and shared again", async () => {
  const bots = await loadBots();
  const bot = bots.find((b) => b.id === "haiku-4-5-max");
  const createClient = () => new BotClient(new Worker(new URL("../../packages/runtime/node-worker.js", import.meta.url)));
  const played = await runLiveMatch({
    bot, seed: 5, mirrored: true, createClient,
    readInput: (tick) => ({ thrust: 1, turn: tick < 30 ? 1 : 0 }), pacer: async () => {},
  });
  const encoded = await encodeChallenge(challengeFromReplay(played));
  const page = await browser.page();
  await page.goto(`${site.url}/#m=${encoded}`);
  await loaded(page);
  assert.equal(await page.text("#current-mode"), "Manual duel");
  assert.equal(await page.eval("document.querySelector('#bot-b').selectedOptions[0].textContent.startsWith('Claude Haiku 4.5')"), true);
  await ended(page);
  assert.equal(await page.hidden("#beat-challenge"), false);
  assert.equal(await page.hidden("#copy-challenge"), false);
  await page.click("#beat-challenge");
  await page.waitFor("document.querySelector('#live-hud').hidden === false");
  assert.equal(await page.text("#record-label"), "LIVE");
  await page.key("KeyW", true);
  await page.waitFor("document.querySelector('#result-banner').hidden === false", 150000);
  await page.key("KeyW", false);
  await page.waitFor("location.hash.startsWith('#m=')");
  assert.equal(await page.hidden("#beat-challenge"), true, "the own match is not a challenge to beat");
  assert.equal(await page.hidden("#copy-challenge"), false);
  clean(page);
  await page.close();
});

test("panels switch in place: rules, bot lab gate, tournament standings and highlights", async () => {
  const page = await browser.page();
  await page.goto(site.url + "/rules/");
  assert.equal(await page.hidden("#panel-rules"), false);
  assert.notEqual(await page.hidden("#stage-loading"), true, "the arena waits until it is shown");
  await page.click('[data-tab="lab"]');
  await page.waitFor("location.pathname === '/lab/'");
  await page.click("#run-gate");
  await page.waitFor("!!document.querySelector('#gate-results .gate-verdict')", 60000);
  await page.click('[data-tab="tournament"]');
  await page.waitFor("location.pathname === '/tournament/'");
  await page.waitFor("document.querySelectorAll('#ranking-surface tbody tr').length >= 2");
  assert.ok((await page.eval("document.querySelectorAll('#tournament-highlights tbody tr').length")) >= 1);
  assert.match(await page.eval("document.querySelector('#tournament-highlights a').getAttribute('href')"), /\?a=.*&b=.*&seed=\d+&spawn=/);
  await page.click('[data-tab="arena"]');
  await page.waitFor("location.pathname === '/'");
  await loaded(page);
  clean(page);
  await page.close();
});

test("on a phone the manual match shows touch buttons that drive the robot", async () => {
  const mobile = await launchBrowser({ mobile: true });
  try {
    const page = await mobile.page();
    await page.goto(site.url + "/?a=fable-5-1-max&b=haiku-4-5-max&seed=5&spawn=mirror");
    await loaded(page);
    await page.click("#play-manual");
    await page.waitFor("document.querySelector('#touch-pad').hidden === false");
    const before = Number(await page.text("#energy-0"));
    await page.touch('#touch-pad button[data-control="forward"]', true);
    await page.wait(2000);
    await page.touch('#touch-pad button[data-control="forward"]', false);
    assert.ok(Number(await page.text("#energy-0")) < before, "thrust spends energy");
    assert.equal(await page.eval("getComputedStyle(document.querySelector('.camera-actions')).display"), "none");
    await page.click("#live-stop");
    clean(page);
    await page.close();
  } finally {
    await mobile.close();
  }
});
