import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderSite, botSlug } from "../packages/site/prerender.js";
import { RULE_CARDS, HAZARD_CARDS, SITE, TABS, normalizeRoute, tabForRoute } from "../packages/site/content.js";
import { projectRoot } from "../packages/bot-catalog-node.js";

const BASE = "https://example.test/arena/";
const shell = () =>
  readFile(resolve(projectRoot, "packages/viewer/public/index.html"), "utf8");

const style = () => ({
  closingShare: 0.4, approachSpeed: 0.6, facingShare: 0.6, proximityShare: 0.5,
  contactShare: 0.2, engagementRate: 7, wedgeShare: 0.66, speed: 1.2,
  turnRate: 0.6, idleShare: 0.2, edgeShare: 0.03, spendRate: 13,
  recharges: 4, burns: 0,
});
const code = () => ({
  language: "js", bytes: 2048, lines: 40, codeLines: 30, commentLines: 6,
  blankLines: 4, functions: 3, statements: 35, complexity: 12, maxDepth: 3,
});
const bots = () => [
  {
    id: "alpha-max", model: "Alpha 1", provider: "OpenAI", thinking: "ultra",
    harness: "Codex", provenance: "iterative", file: "packages/bots/alpha-max.js",
    source: "// <script>alert('x')</script>\nexport function tick() {}\n",
  },
  {
    id: "Beta Bot", model: "Beta 2", provider: null, thinking: null,
    harness: null, provenance: "reference", file: "packages/bots/beta-bot.js",
    source: "export function tick() {}\n",
  },
];
const standings = () => ({
  specVersion: "0.2.2-draft", engineVersion: "0.2.2-r1", mode: "exhibition",
  budgetMode: "fuel", format: "round-robin", status: "complete", rounds: 1,
  totalMatches: 2, replicates: 1000,
  bots: bots().map(bot => ({ id: bot.id, codeSha256: "a".repeat(64), code: code() })),
  gates: [],
  records: [{ a: 0, b: 1, seed: 0, mirrored: false, score: 1, reason: "ring-out", ticks: 600, firstContact: 100, round: 1 }],
  ranking: bots().map((bot, i) => ({
    id: bot.id, model: bot.model, provider: bot.provider, thinking: bot.thinking,
    harness: bot.harness, provenance: bot.provenance, score: 120 - 40 * i,
    ci: [100 - 40 * i, 140 - 40 * i], matches: 2, wins: 2 - i, draws: 0,
    winRate: 1 - 0.5 * i, flipDifferential: 1 - i, ringOutsInflicted: 1 - i,
    ringOutsTaken: i, meanEnergy: 100, meanFirstContactTick: i ? null : 120,
    violationsPerMatch: 0, timeouts: 0, style: style(),
  })),
  generatedAt: "2026-01-02T03:04:05.000Z",
  environment: { node: "v24.0.0", platform: "linux", arch: "x64", cpu: "Test CPU" },
});
const EXAMPLE = "export function tick(s, m) {\n  return { actions: { thrust: 1, turn: 0 }, memory: m };\n}\n";
const render = async (overrides = {}) =>
  renderSite({
    index: await shell(),
    bots: bots(),
    standings: standings(),
    example: EXAMPLE,
    baseUrl: BASE,
    ...overrides,
  });

test("every page is a complete document with its own title, description, canonical and valid JSON-LD", async () => {
  const files = await render();
  const pages = [...files].filter(([path]) => path.endsWith(".html") && path !== "404.html");
  assert.deepEqual(pages.map(([path]) => path).sort(), [
    "bots/alpha-max/index.html",
    "bots/beta-bot/index.html",
    "bots/index.html",
    "index.html",
    "lab/index.html",
    "rules/index.html",
    "tournament/index.html",
  ]);
  const titles = new Set(), descriptions = new Set();
  for (const [path, html] of pages) {
    const url = new URL(path.replace(/index\.html$/, ""), BASE).href;
    const title = html.match(/<title>(.*?)<\/title>/)?.[1];
    const description = html.match(/<meta name="description" content="(.*?)">/)?.[1];
    assert.ok(title && title.length <= 70, `${path} needs a short title`);
    assert.ok(description && description.length > 60 && description.length <= 200, `${path} needs a description`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${url}">`), path);
    assert.match(html, new RegExp(`<meta property="og:url" content="${url}">`), path);
    titles.add(title);
    descriptions.add(description);
    for (const [, block] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
      for (const entry of JSON.parse(block))
        assert.equal(entry["@context"], "https://schema.org", path);
  }
  // Duplicate titles and descriptions across URLs are the classic own goal.
  assert.equal(titles.size, pages.length);
  assert.equal(descriptions.size, pages.length);
});

test("assets and links resolve from any depth, so the site works under a path prefix", async () => {
  const files = await render();
  assert.match(files.get("rules/index.html"), /<link rel="stylesheet" href="\.\.\/style\.css">/);
  assert.match(files.get("bots/alpha-max/index.html"), /<link rel="stylesheet" href="\.\.\/\.\.\/style\.css">/);
  assert.match(files.get("bots/index.html"), /href="\.\/alpha-max\/"/);
  for (const [path, html] of files)
    if (path.endsWith(".html"))
      assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/, `${path} must not use root-relative links`);
});

test("the application shell keeps its script and gains metadata plus crawlable links", async () => {
  const files = await render();
  const home = files.get("index.html");
  assert.match(home, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(home, /<link rel="canonical" href="https:\/\/example\.test\/arena\/">/);
  assert.match(home, /"@type":"WebApplication"/);
  for (const path of ["./rules/", "./tournament/", "./bots/"])
    assert.ok(home.includes(`href="${path}"`), `the shell must link ${path}`);
  await assert.rejects(render({ index: "<html><head></head>" }), /head and a body/);
});

test("rules, standings and controller pages carry the content they exist for", async () => {
  const files = await render();
  const rules = files.get("rules/index.html");
  for (const card of [...RULE_CARDS, ...HAZARD_CARDS]) assert.ok(rules.includes(card.title), card.number);
  assert.ok(rules.includes("300 <small>starting energy</small>"), "spec constants must be interpolated");
  const lab = files.get("lab/index.html");
  assert.ok(lab.includes("tick(sensors, memory)"), "the contract is the point of the page");
  assert.ok(lab.includes(EXAMPLE.trimEnd()), "the minimal controller comes from the specification");
  const tournament = files.get("tournament/index.html");
  for (const text of ["Alpha 1", "Beta 2", "Craft index", "Play style", "Implementation", "120.0"])
    assert.ok(tournament.includes(text), text);
  const alpha = files.get("bots/alpha-max/index.html");
  assert.ok(alpha.includes("a".repeat(64)), "the source hash identifies the measured file");
  assert.ok(alpha.includes("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"), "sources are escaped, never executed");
  assert.doesNotMatch(alpha.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ""), /<script/);
});

test("the panel pages boot the application, the reference pages stay plain", async () => {
  const files = await render();
  for (const tab of TABS) {
    const path = tab.route + "index.html";
    const html = files.get(path);
    assert.ok(html.includes('<div id="app">'), `${path} must give its content to the application`);
    assert.match(html, /<script type="module" src="[^"]*app\.js"><\/script>/, path);
    assert.equal(html.match(/<title>(.*?)<\/title>/)[1], tab.title, path);
    // What the application intercepts has to be a real link for a crawler.
    if (tab.route)
      for (const other of TABS)
        assert.ok(html.includes(`data-tab="${other.id}"`), `${path} must link ${other.id}`);
  }
  for (const path of ["bots/index.html", "bots/alpha-max/index.html"]) {
    assert.doesNotMatch(files.get(path), /src="[^"]*app\.js"/, path);
    assert.ok(!files.get(path).includes('<div id="app">'), path);
  }
});

test("a route names one panel, whatever shape the URL arrives in", () => {
  for (const [route, id] of [
    ["", "arena"], ["index.html", "arena"], ["lab/", "lab"], ["rules", "rules"],
    ["rules/index.html", "rules"], ["tournament/?seed=3", "tournament"],
  ])
    assert.equal(tabForRoute(route)?.id, id, route);
  for (const route of ["bots/", "bots/alpha-max/", "nowhere/"])
    assert.equal(tabForRoute(route), null, route);
  assert.equal(normalizeRoute("/rules"), "rules/");
});

test("sitemap, robots and llms.txt describe exactly the pages that exist", async () => {
  const files = await render();
  const urls = [...files.get("sitemap.xml").matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  const expected = ["", "lab/", "rules/", "tournament/", "bots/", "bots/alpha-max/", "bots/beta-bot/"].map(
    path => new URL(path, BASE).href,
  );
  assert.deepEqual([...urls].sort(), [...expected].sort());
  assert.equal(new Set(urls).size, urls.length);
  assert.match(files.get("sitemap.xml"), /<lastmod>2026-01-02<\/lastmod>/);
  assert.match(files.get("robots.txt"), new RegExp(`Sitemap: ${BASE}sitemap\\.xml`));
  const llms = files.get("llms.txt");
  assert.match(llms, /^# llms-robot-arena\n\n> /);
  for (const url of expected) assert.ok(llms.includes(`(${url})`), `llms.txt must link ${url}`);
  assert.ok(llms.includes(`(${SITE.repository})`));
  assert.match(files.get("404.html"), /<meta name="robots" content="noindex">/);
});

test("a base URL without a trailing slash still yields absolute page URLs", async () => {
  const files = await render({ baseUrl: "https://example.test/arena" });
  assert.match(files.get("bots/index.html"), /<link rel="canonical" href="https:\/\/example\.test\/arena\/bots\/">/);
});

test("the site is still generated without a published run, and bad IDs are refused", async () => {
  const files = await render({ standings: null });
  assert.ok(!files.has("tournament/index.html"));
  assert.ok(!files.get("sitemap.xml").includes("/tournament/"));
  assert.match(files.get("bots/index.html"), /Alpha 1/);
  assert.equal(botSlug({ id: "GPT-5.6 Sol" }), "gpt-5-6-sol");
  for (const ids of [["same-id", "Same ID"], ["...", "ok-id"]])
    await assert.rejects(
      render({ bots: bots().map((bot, i) => ({ ...bot, id: ids[i] })), standings: null }),
      /unique, non-empty URL slugs/,
    );
});
