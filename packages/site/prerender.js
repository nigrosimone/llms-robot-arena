// Static pages written next to the application: the arena needs WebGL and a
// script to say anything, these say it in HTML for crawlers and for readers who
// only want the numbers.
import { SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";
import { botName, botDetails, botProvider } from "../bot-catalog.js";
import { STYLE_AXES, formatStyleValue, styleLabel, styleProfiles } from "../tournament/style.js";
import { highlights, highlightLabel } from "../tournament/spectacle.js";
import { INDEX_TERMS, compositeIndex } from "../tournament/composite.js";
import {
  SITE, RULE_CARDS, HAZARD_CARDS, RULES_NOTE, ruleCards, SPEC_TABLE,
  TABS, CONTROLLERS, CONTRACT_CARD,
} from "./content.js";

export const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// A bot ID is free-form catalog metadata; a URL segment is not.
export const botSlug = (bot) =>
  bot.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const tabTitle = (id) => TABS.find((tab) => tab.id === id).title;
const depthOf = (path) => (path === "" ? 0 : path.split("/").length - 1);
const relative = (depth, path) => ("../".repeat(depth) || "./") + path;
const absolute = (baseUrl, path) => new URL(path, baseUrl).href;
// JSON-LD lives inside a script element: no raw "<" may reach the parser.
const jsonLd = (data) => JSON.stringify(data).replace(/</g, "\\u003c");
const number = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "—");

const table = (headers, rows) =>
  `<div class="table-scroll"><table><thead><tr>${headers
    .map((h) => `<th>${h}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

const card = (title, tag, body) =>
  `<section class="tournament-matches"><div class="ranking-header"><h2>${esc(title)}</h2>${
    tag ? `<span class="tag">${esc(tag)}</span>` : ""
  }</div>${body}</section>`;

const facts = (rows) =>
  table(["Field", "Value"], rows.map(([k, v]) => [esc(k), `<span class="mono">${esc(v)}</span>`]));

// The application shell names its bundles (hashed by the Angular build) and
// its host element; the static pages reuse both so the app can take over.
export function shellAssets(index) {
  const attributes = (tag, attribute) =>
    [...index.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))]
      .map(([element]) => element.match(new RegExp(`${attribute}="([^"]+)"`))?.[1])
      .filter(Boolean)
      .map((value) => value.replace(/^\.\//, ""));
  const links = [...index.matchAll(/<link\b[^>]*>/g)].map(([element]) => element);
  const href = (element) => element.match(/href="([^"]+)"/)?.[1]?.replace(/^\.\//, "");
  return {
    styles: links.filter((l) => /rel="stylesheet"/.test(l)).map(href).filter(Boolean),
    preloads: links.filter((l) => /rel="modulepreload"/.test(l)).map(href).filter(Boolean),
    scripts: attributes("script", "src").filter((src) => !/gc\.zgo\.at/.test(src)),
    host: index.includes("<app-root") ? "app-root" : "div",
  };
}
let ASSETS = { styles: ["style.css"], preloads: [], scripts: ["app.js"], host: "div" };

function layout({ path, title, description, main, schema, baseUrl, app = false }) {
  const depth = depthOf(path);
  const to = (target) => relative(depth, target);
  const canonical = absolute(baseUrl, path);
  const nav = TABS.map(
    (tab) =>
      `<a class="nav-button${tab.route === path ? " selected" : ""}" data-tab="${tab.id}" href="${to(
        tab.route,
      )}"${tab.route === path ? ' aria-current="page"' : ""}>${esc(tab.label)}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${SITE.themeColor}">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(SITE.name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="${SITE.icon}">
  ${ASSETS.styles.map((style) => `<link rel="stylesheet" href="${to(style)}">`).join("\n  ")}
  <script type="application/ld+json">${jsonLd(schema)}</script>
  ${SITE.analytics}
</head>
<body>
${app ? `<${ASSETS.host} id="app">` : ""}<header class="header">
 <a class="brand" href="${to("")}" aria-label="${esc(SITE.name)}, home"><span class="brand-mark" aria-hidden="true">R<span>↗</span></span><span>llms-<span class="brand-second">robot-arena</span></span></a>
 <nav aria-label="Main navigation">${nav}</nav>
 <div class="header-end"><span class="version">SPEC ${SPEC_VERSION.replace("-draft", "")} </span></div>
</header>
<main>${main}</main>
<footer class="footer"><span><a href="${SITE.repository}" title="View ${esc(SITE.name)} on GitHub">${esc(SITE.name)}</a></span><nav class="footer-links" aria-label="Reference pages"><a href="${to(
    CONTROLLERS.route,
  )}">${esc(CONTROLLERS.label)}</a></nav><span>Code makes the difference.</span><span>ENGINE ${ENGINE_VERSION}</span></footer>
${app ? `</${ASSETS.host}>\n${ASSETS.preloads.map((p) => `<link rel="modulepreload" href="${to(p)}">`).join("\n")}${ASSETS.scripts.map((s) => `<script type="module" src="${to(s)}"></script>`).join("\n")}` : ""}
</body>
</html>
`;
}

const heading = (eyebrow, title, lead) =>
  `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(
    title,
  )}<span>.</span></h1></div></div>${lead ? `<p class="tournament-note">${lead}</p>` : ""}`;

const breadcrumbs = (baseUrl, trail) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((item, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: item.name,
    item: absolute(baseUrl, item.path),
  })),
});

function rulesPage(baseUrl) {
  const constants = SPEC_TABLE.map((group) => card(group.group, null, facts(group.rows))).join("");
  return layout({
    path: "rules/",
    app: true,
    title: tabTitle("rules"),
    description:
      "The rules of the llms-robot-arena duel: a shrinking 16 m platform, wedge flips, quadratic energy cost, hazards, victory order, and every engine constant a controller can rely on.",
    baseUrl,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: "Arena rules and engine constants",
        description:
          "Rules, hazards, victory order and engine constants of the llms-robot-arena duel.",
        url: absolute(baseUrl, "rules/"),
        isPartOf: { "@type": "WebSite", name: SITE.name, url: baseUrl },
        version: SPEC_VERSION,
        about: "Autonomous robot combat simulation",
      },
      breadcrumbs(baseUrl, [
        { name: "Arena", path: "" },
        { name: "Rules", path: "rules/" },
      ]),
    ],
    main: `${heading(
      `SPEC ${SPEC_VERSION.replace("-draft", "")}`,
      "Same hardware. Different minds",
      "Both robots have the same chassis, the same motors and the same energy. Only the controller changes. These are the rules the engine enforces, identical in the browser and in the tournament CLI.",
    )}
  <div class="rules-grid">${ruleCards(RULE_CARDS)}</div>
  <div class="rules-grid hazard-rules">${ruleCards(HAZARD_CARDS)}</div>
  <div class="review-note"><strong>${RULES_NOTE.title}</strong><p>${RULES_NOTE.body}</p></div>
  ${constants}
  <p class="tournament-note">The complete specification, the bot contract and the conformity checks are in <a class="text-link" href="${SITE.repository}/blob/main/AGENTS.md">AGENTS.md</a>. <a class="text-link" href="../">Open the arena</a> to watch the rules apply.</p>`,
  });
}

const rankingTable = (standings) =>
  table(
    [
      "#",
      "Controller",
      "Bradley–Terry",
      "95% CI",
      "Score %",
      "W / D / L",
      "Δ Flip",
      "Ring-out + / −",
      "Mean energy",
      "First contact",
      "Violations / match",
      "Timeouts",
    ],
    standings.ranking.map((row, i) => [
      `<span class="rank-number">${String(i + 1).padStart(2, "0")}</span>`,
      `<strong>${esc(botName(row))}</strong><small>${esc(botDetails(row))}</small>`,
      `<span class="bt-score">${number(row.score)}</span>`,
      `<span class="mono">${row.ci?.map((n) => n.toFixed(1)).join(" – ") ?? "—"}</span>`,
      `${number(row.winRate * 100)}%`,
      `<span class="mono">${row.wins} / ${row.draws} / ${row.matches - row.wins - row.draws}</span>`,
      `${row.flipDifferential > 0 ? "+" : ""}${row.flipDifferential}`,
      `${row.ringOutsInflicted} / ${row.ringOutsTaken}`,
      number(row.meanEnergy),
      row.meanFirstContactTick === null ? "—" : number(row.meanFirstContactTick / 60) + " s",
      number(row.violationsPerMatch, 2),
      String(row.timeouts),
    ]),
  );

function tournamentPage(standings, baseUrl) {
  const profiles = styleProfiles(standings.ranking);
  const index = compositeIndex(standings);
  const metrics = new Map(standings.bots.map((bot) => [bot.id, bot.code]));
  const environment = [
    standings.environment?.platform,
    standings.environment?.arch,
    standings.environment?.cpu,
  ]
    .filter(Boolean)
    .join(" · ");
  return layout({
    path: "tournament/",
    app: true,
    title: tabTitle("tournament"),
    description: `Bradley–Terry standings of ${standings.ranking.length} LLM-written robot controllers over ${standings.totalMatches} deterministic duels: strength, confidence intervals, play style, source metrics and craft index.`,
    baseUrl,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "llms-robot-arena published standings",
        description: `Results of a ${standings.format} exhibition between ${standings.ranking.length} autonomous robot controllers over ${standings.totalMatches} matches with the ${standings.budgetMode} budget.`,
        url: absolute(baseUrl, "tournament/"),
        dateModified: standings.generatedAt,
        isPartOf: { "@type": "WebSite", name: SITE.name, url: baseUrl },
        creator: { "@type": "Person", name: "Simone Nigro" },
        distribution: {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: absolute(baseUrl, "standings.json"),
        },
        variableMeasured: [
          "Bradley–Terry strength",
          "win rate",
          "flip differential",
          "ring-outs",
          "mean energy",
          "violations per match",
        ],
      },
      breadcrumbs(baseUrl, [
        { name: "Arena", path: "" },
        { name: "Standings", path: "tournament/" },
      ]),
    ],
    main: `${heading(
      "TOURNAMENT",
      "Earn your ranking",
      `One static exhibition run: every catalog controller passes the conformity gate, then plays a ${
        standings.format === "round-robin" ? "full round robin" : "short run"
      } of ${standings.totalMatches} matches under the ${
        standings.budgetMode
      } budget. Strength is a regularized Bradley–Terry fit with mean 100. Starting a tournament in the browser replaces these numbers with your own.`,
    )}
  ${card("Ranking", "REGULARIZED BRADLEY–TERRY · MEAN 100", rankingTable(standings))}
  ${
    index
      ? card(
          "Craft index",
          "RESULTS AND SOURCE · NOT THE RANKING",
          table(
            [
              "Controller",
              "Craft index",
              ...INDEX_TERMS.map((term) => `${esc(term.label)} · ${Math.round(term.weight * 100)}%`),
            ],
            standings.ranking.map((row, i) => [
              `<strong>${esc(botName(row))}</strong>`,
              `<span class="bt-score">${number(index[i].index)}</span>`,
              ...INDEX_TERMS.map(
                (term) =>
                  `<span class="mono">${
                    index[i].terms[term.key] === null ? "—" : number(index[i].terms[term.key], 2)
                  }</span>`,
              ),
            ]),
          ),
        )
      : ""
  }
  ${
    highlights(standings).length
      ? card(
          "Highlights",
          "FLIPS FIRST, THEN ENGAGEMENTS",
          table(
            ["Match", "Seed / spawn", "Flips", "Engagements", "Result", "Watch"],
            highlights(standings).map((h) => {
              const { match, result, search } = highlightLabel(standings, h);
              return [
                `<strong>${esc(match)}</strong>`,
                `<span class="mono">${h.seed} / ${h.mirrored ? "mirrored" : "standard"}</span>`,
                `<span class="mono">${h.flips}</span>`,
                `<span class="mono">${h.engagements}</span>`,
                `${esc(result)}, ${esc(h.reason)} at ${Math.round(h.ticks / 60)} s`,
                `<a class="text-link" href="../${esc(search)}">Simulate</a>`,
              ];
            }),
          ),
        )
      : ""
  }
  ${
    profiles
      ? card(
          "Play style",
          "HOW THEY PLAY · NOT HOW WELL",
          table(
            ["Controller", "Profile", ...STYLE_AXES.map((axis) => esc(axis.label))],
            standings.ranking.map((row, i) => [
              `<strong>${esc(botName(row))}</strong>`,
              `<span class="tag">${esc(styleLabel(profiles[i]))}</span>`,
              ...STYLE_AXES.map(
                (axis) => `<span class="mono">${esc(formatStyleValue(axis, row.style))}</span>`,
              ),
            ]),
          ),
        )
      : ""
  }
  ${card(
    "Implementation",
    "MEASURED FROM THE SUBMITTED SOURCE",
    table(
      [
        "Controller",
        "Language",
        "Lines",
        "Code",
        "Comments",
        "Functions",
        "Cyclomatic",
        "Max nesting",
        "Size",
      ],
      standings.ranking.map((row) => {
        const code = metrics.get(row.id);
        return [
          `<strong>${esc(botName(row))}</strong>`,
          esc(code?.language ?? "—"),
          ...["lines", "codeLines", "commentLines", "functions", "complexity", "maxDepth"].map(
            (key) => `<span class="mono">${code ? code[key] : "—"}</span>`,
          ),
          `<span class="mono">${code ? (code.bytes / 1024).toFixed(1) + " kB" : "—"}</span>`,
        ];
      }),
    ),
  )}
  ${card(
    "Run",
    "REPRODUCIBLE WITH npm run standings",
    facts([
      ["Format", standings.format === "round-robin" ? "Full round robin" : "Quick rounds"],
      ["Controllers", String(standings.ranking.length)],
      ["Matches", String(standings.totalMatches)],
      ["Rounds", String(standings.rounds)],
      ["Budget", standings.budgetMode],
      ["Bootstrap replicates", String(standings.replicates)],
      ["Spec / engine", `${standings.specVersion} / ${standings.engineVersion}`],
      ["Generated", new Date(standings.generatedAt).toISOString().slice(0, 10)],
      ["Node", standings.environment?.node ?? "—"],
      ["Machine", environment || "—"],
    ]),
  )}
  <p class="tournament-note">Results from different engine versions or budgets are not comparable. The raw run is <a class="text-link" href="../standings.json">standings.json</a>, and each entry has its own page under <a class="text-link" href="../bots/">Controllers</a>.</p>`,
  });
}

function labPage(example, baseUrl) {
  return layout({
    path: "lab/",
    app: true,
    title: tabTitle("lab"),
    description:
      "Write an autonomous robot controller in JavaScript, check it against the contract and run it in the browser: one tick function, thrust and turn, 64 KB of memory.",
    baseUrl,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: "Write a robot controller",
        description:
          "The bot contract of llms-robot-arena: one tick export, thrust and turn, JSON memory, QuickJS sandbox.",
        url: absolute(baseUrl, "lab/"),
        isPartOf: { "@type": "WebSite", name: SITE.name, url: baseUrl },
        version: SPEC_VERSION,
        proficiencyLevel: "Beginner",
      },
      breadcrumbs(baseUrl, [
        { name: "Arena", path: "" },
        { name: "Bot Lab", path: "lab/" },
      ]),
    ],
    main: `${heading(
      "CONTROLLER WORKSPACE",
      "Your code. Your robot",
      "The Bot Lab writes, checks and runs a controller in the browser: no install, no account, no API key. What you write stays in the page, so download the file to keep it.",
    )}
  <div class="rules-grid">
   <article class="info-card">${CONTRACT_CARD}</article>
   <article class="info-card"><span class="rule-number">SANDBOX</span><h2>QuickJS in a worker.</h2><p>One JavaScript file, one <code>tick</code> export, no imports and no host APIs. Sensors and memory arrive frozen and every call gets a fresh module scope, so nothing carries over except the memory you return. It runs as QuickJS WebAssembly, one worker per robot.</p></article>
   <article class="info-card"><span class="rule-number">CONFORMANCE GATE</span><h2>Checked before it fights.</h2><p>200 snapshots and 600 inert ticks look at execution, purity, memory and timing. They say nothing about strategy: passing the gate means the controller is admissible, not that it is any good.</p></article>
  </div>
  ${
    example
      ? card(
          "Minimal controller",
          "PUBLIC CONTRACT MATERIAL · A STARTING TEMPLATE",
          `<div class="source-view"><pre><code>${esc(example)}</code></pre></div>`,
        )
      : ""
  }
  <p class="tournament-note">${
    example
      ? "That one turns to face the opponent and drives at it, ignoring energy, holes and flames, which is why every registered controller beats it. "
      : ""
  }The full contract, the types and the conformity checks are in <a class="text-link" href="${SITE.repository}/blob/main/AGENTS.md">AGENTS.md</a>, and the <a class="text-link" href="../bots/">registered controllers</a> show what a complete one looks like.</p>`,
  });
}

function botsPage(bots, standings, baseUrl) {
  const rank = new Map(standings?.ranking.map((row, i) => [row.id, { row, position: i + 1 }]) ?? []);
  const rows = [...bots]
    .sort((a, b) => (rank.get(a.id)?.position ?? Infinity) - (rank.get(b.id)?.position ?? Infinity))
    .map((bot) => {
      const entry = rank.get(bot.id);
      return [
        entry ? `<span class="rank-number">${String(entry.position).padStart(2, "0")}</span>` : "—",
        `<a class="text-link" href="./${botSlug(bot)}/"><strong>${esc(botName(bot))}</strong></a><small>${esc(
          botDetails(bot),
        )}</small>`,
        esc(botProvider(bot)),
        esc(bot.thinking ?? "—"),
        esc(bot.harness ?? "—"),
        esc(bot.provenance ?? "—"),
        entry ? `<span class="bt-score">${number(entry.row.score)}</span>` : "—",
      ];
    });
  return layout({
    path: "bots/",
    title: "Controllers - llms-robot-arena",
    description: `The ${bots.length} controllers registered in llms-robot-arena: the model and harness each one was written with, its source, and its result in the published standings.`,
    baseUrl,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "llms-robot-arena controllers",
        description: "Registered autonomous robot controllers, with source and results.",
        url: absolute(baseUrl, "bots/"),
        isPartOf: { "@type": "WebSite", name: SITE.name, url: baseUrl },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: bots.length,
          itemListElement: bots.map((bot, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: botName(bot),
            url: absolute(baseUrl, `bots/${botSlug(bot)}/`),
          })),
        },
      },
      breadcrumbs(baseUrl, [
        { name: "Arena", path: "" },
        { name: "Controllers", path: "bots/" },
      ]),
    ],
    main: `${heading(
      "CONTROLLERS",
      "One function. Two commands",
      "Every controller is a single JavaScript file exporting <code>tick(sensors, memory)</code> and returning thrust and turn. Same robot, same arena, same energy: the code is the only variable.",
    )}
  ${card(
    "Registered controllers",
    "ORDERED BY THE PUBLISHED STANDINGS",
    table(["#", "Controller", "Provider", "Thinking", "Harness", "Provenance", "Strength"], rows),
  )}
  <p class="tournament-note">Catalog additions are maintainer-managed, because a claimed model origin cannot be verified from a pull request. See <a class="text-link" href="${SITE.repository}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>`,
  });
}

function botPage(bot, standings, baseUrl) {
  const position = standings ? standings.ranking.findIndex((row) => row.id === bot.id) : -1;
  const row = position >= 0 ? standings.ranking[position] : null;
  const record = standings?.bots.find((entry) => entry.id === bot.id) ?? null;
  const profiles = standings ? styleProfiles(standings.ranking) : null;
  const name = botName(bot);
  const results = row
    ? card(
        "Result in the published standings",
        `RANK ${String(position + 1).padStart(2, "0")} OF ${standings.ranking.length}`,
        facts([
          ["Bradley–Terry strength", number(row.score)],
          ["95% CI", row.ci?.map((n) => n.toFixed(1)).join(" – ") ?? "—"],
          ["Matches", String(row.matches)],
          ["W / D / L", `${row.wins} / ${row.draws} / ${row.matches - row.wins - row.draws}`],
          ["Score %", number(row.winRate * 100) + "%"],
          ["Flip differential", `${row.flipDifferential > 0 ? "+" : ""}${row.flipDifferential}`],
          ["Ring-outs inflicted / taken", `${row.ringOutsInflicted} / ${row.ringOutsTaken}`],
          ["Mean energy", number(row.meanEnergy)],
          [
            "Mean first contact",
            row.meanFirstContactTick === null ? "—" : number(row.meanFirstContactTick / 60) + " s",
          ],
          ["Violations per match", number(row.violationsPerMatch, 2)],
          ["Timeouts", String(row.timeouts)],
        ]),
      )
    : "";
  const style =
    row && profiles
      ? card(
          "Play style",
          styleLabel(profiles[position]).toUpperCase(),
          table(
            ["Axis", "Value"],
            STYLE_AXES.map((axis) => [
              esc(axis.label),
              `<span class="mono">${esc(formatStyleValue(axis, row.style))}</span>`,
            ]),
          ),
        )
      : "";
  const code = record?.code
    ? card(
        "Source metrics",
        "PARSED, NEVER EXECUTED",
        facts([
          ["Language", "JavaScript"],
          ["Total lines", String(record.code.lines)],
          ["Code lines", String(record.code.codeLines)],
          ["Comment lines", String(record.code.commentLines)],
          ["Functions", String(record.code.functions)],
          ["Statements", String(record.code.statements)],
          ["Cyclomatic complexity", String(record.code.complexity)],
          ["Max nesting", String(record.code.maxDepth)],
          ["Size", (record.code.bytes / 1024).toFixed(1) + " kB"],
          ["SHA-256", record.codeSha256 ?? "—"],
        ]),
      )
    : "";
  return layout({
    path: `bots/${botSlug(bot)}/`,
    title: `${name} controller - llms-robot-arena`,
    description: `${name}: source, play style, source metrics and results over ${
      row ? row.matches : 0
    } deterministic duels. ${botDetails(bot)}.`,
    baseUrl,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        name: `${name} robot controller`,
        description: `Autonomous robot controller for llms-robot-arena. ${botDetails(bot)}.`,
        url: absolute(baseUrl, `bots/${botSlug(bot)}/`),
        codeRepository: SITE.repository,
        programmingLanguage: "JavaScript",
        codeSampleType: "full solution",
        isPartOf: { "@type": "WebSite", name: SITE.name, url: baseUrl },
        ...(bot.provider ? { creator: { "@type": "Organization", name: bot.provider } } : {}),
      },
      breadcrumbs(baseUrl, [
        { name: "Arena", path: "" },
        { name: "Controllers", path: "bots/" },
        { name, path: `bots/${botSlug(bot)}/` },
      ]),
    ],
    main: `${heading(
      "CONTROLLER",
      name,
      `${esc(botProvider(bot))}${bot.thinking ? ` · thinking ${esc(bot.thinking)}` : ""}${
        bot.harness ? ` · written with ${esc(bot.harness)}` : ""
      }${bot.provenance ? ` · ${esc(bot.provenance)}` : ""}. One file, one <code>tick</code> export, no imports.`,
    )}
  ${results}
  ${style}
  ${code}
  ${card("Source", bot.file, `<div class="source-view"><pre><code>${esc(bot.source)}</code></pre></div>`)}
  <p class="tournament-note">Load this controller in the <a class="text-link" href="../../">arena</a>, or read the rules it plays under in the <a class="text-link" href="../../rules/">spec</a>.</p>`,
  });
}

function homePage(index, bots, standings, baseUrl) {
  if (!index.includes("</head>") || !index.includes("</body>"))
    throw new Error("The application shell must have a head and a body to extend.");
  const leader = standings?.ranking[0];
  const head = [
    `<link rel="canonical" href="${esc(baseUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(SITE.name)}">`,
    `<meta property="og:title" content="${esc(SITE.title)}">`,
    `<meta property="og:description" content="${esc(SITE.description)}">`,
    `<meta property="og:url" content="${esc(baseUrl)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<script type="application/ld+json">${jsonLd([
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE.name,
        description: SITE.description,
        url: baseUrl,
      },
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: SITE.name,
        description: SITE.description,
        url: baseUrl,
        applicationCategory: "GameApplication",
        operatingSystem: "Any browser with WebGL 2",
        browserRequirements: "Requires WebGL 2 and Web Workers",
        softwareVersion: ENGINE_VERSION,
        codeRepository: SITE.repository,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ])}</script>`,
  ].join("\n  ");
  const noscript = `<noscript>
 <div class="static-intro">
  <h1>${esc(SITE.name)}</h1>
  <p>${esc(SITE.tagline)} The arena runs the duel in your browser and needs JavaScript and WebGL 2. These pages do not:</p>
  <ul>
   <li><a href="./rules/">Arena rules and engine constants</a></li>
   <li><a href="./tournament/">Published standings${
     leader ? `, led by ${esc(botName(leader))}` : ""
   }</a></li>
   <li><a href="./bots/">The ${bots.length} registered controllers and their source</a></li>
   <li><a href="${SITE.repository}">Source repository</a></li>
  </ul>
 </div>
</noscript>`;
  return index
    .replace("</head>", `  ${head}\n</head>`)
    .replace("</body>", `${noscript}\n</body>`);
}

const sitemap = (pages, baseUrl, lastmod) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map((path) => `  <url><loc>${esc(absolute(baseUrl, path))}</loc><lastmod>${lastmod}</lastmod></url>`)
  .join("\n")}
</urlset>
`;

function llmsTxt(bots, standings, baseUrl) {
  const line = (label, path, note) => `- [${label}](${absolute(baseUrl, path)}): ${note}`;
  return `# ${SITE.name}

> ${SITE.tagline} A deterministic 3D arena where autonomous controllers, most of them written by an LLM, fight one against one. Every duel is reproducible from its seed and replayed frame by frame.

A match lasts 120 seconds at 60 Hz on a 16 × 16 m platform that starts shrinking after 60 seconds. A controller is one JavaScript file exporting \`tick(sensors, memory)\` and returning thrust and turn. It runs in a QuickJS sandbox with an instruction budget and 64 KB of memory. Controllers written by different models are ranked with a regularized Bradley–Terry fit over a round robin.

## Pages

${line("Arena", "", "the live simulator and replay viewer; needs WebGL 2")}
${line("Bot Lab", "lab/", "the bot contract, the sandbox limits and a minimal controller to start from")}
${line("Rules and engine constants", "rules/", "arena, wedge flips, energy, hazards, victory order and every published constant")}
${line(
  "Published standings",
  "tournament/",
  `Bradley–Terry ranking over ${standings?.totalMatches ?? 0} matches, with play style, source metrics and craft index`,
)}
${line("Controllers", "bots/", "the registered controllers, their provenance and their results")}

## Controllers

${bots
  .map((bot) => line(botName(bot), `bots/${botSlug(bot)}/`, `${botDetails(bot)}; full source on the page`))
  .join("\n")}

## Data and source

${line("standings.json", "standings.json", "the published run as raw JSON: ranking, match records, gates and environment")}
- [Repository](${SITE.repository}): engine, controllers and tournament CLI
- [AGENTS.md](${SITE.repository}/blob/main/AGENTS.md): the complete specification and bot contract
- [CONTRIBUTING.md](${SITE.repository}/blob/main/CONTRIBUTING.md): how a controller gets into the catalog
`;
}

const notFoundPage = (baseUrl) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${SITE.themeColor}">
  <title>Page not found - ${esc(SITE.name)}</title>
  <meta name="robots" content="noindex">
  <link rel="icon" href="${SITE.icon}">
  ${SITE.analytics}
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 12px;
      text-align: center; background: #101317; color: #e6edf1;
      font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; }
    h1 { font-size: 2.5rem; margin: 0; }
    a { color: #c3f66b; }
  </style>
</head>
<body>
  <h1>404</h1>
  <p>That page is not in the arena.</p>
  <p><a href="${esc(baseUrl)}">Back to ${esc(SITE.name)}</a></p>
</body>
</html>
`;

// Every generated file, keyed by its path inside dist.
export function renderSite({
  index,
  bots,
  standings = null,
  example = "",
  baseUrl = SITE.url,
  now = new Date(),
}) {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  ASSETS = shellAssets(index);
  const slugs = bots.map(botSlug);
  if (slugs.some((slug) => !slug) || new Set(slugs).size !== slugs.length)
    throw new Error("Bot IDs must produce unique, non-empty URL slugs.");
  const files = new Map([
    ["index.html", homePage(index, bots, standings, base)],
    ["lab/index.html", labPage(example, base)],
    ["rules/index.html", rulesPage(base)],
    ["bots/index.html", botsPage(bots, standings, base)],
  ]);
  if (standings) files.set("tournament/index.html", tournamentPage(standings, base));
  for (const bot of bots) files.set(`bots/${botSlug(bot)}/index.html`, botPage(bot, standings, base));
  const pages = [
    "",
    "lab/",
    "rules/",
    ...(standings ? ["tournament/"] : []),
    "bots/",
    ...slugs.map((slug) => `bots/${slug}/`),
  ];
  files.set(
    "sitemap.xml",
    sitemap(pages, base, new Date(standings?.generatedAt ?? now).toISOString().slice(0, 10)),
  );
  files.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${absolute(base, "sitemap.xml")}\n`);
  files.set("llms.txt", llmsTxt(bots, standings, base));
  files.set("404.html", notFoundPage(base));
  return files;
}
