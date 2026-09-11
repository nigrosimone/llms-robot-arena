import { SPEC as S, SPEC_VERSION, ENGINE_VERSION, mulberry32 } from "../sim/spec.js";
import { renderReport } from "../tournament/report.js";
import { ArenaViewer } from "./arena.js";
import { stringifyReplay, parseReplay } from "../sim/replay.js";
import builtins from "arena:bots";
import { robotColor } from "./palette.js";
import { botName, botDetails } from "../bot-catalog.js";
import { sortedBotOptions, controllerFilename } from "./controllers.js";
import { exhibitionSchedule } from "../tournament/exhibition.js";
import { STYLE_AXES, formatStyleValue, styleLabel, styleProfiles } from "../tournament/style.js";
import { INDEX_TERMS, compositeIndex } from "../tournament/composite.js";
import { readMatchSettings, matchSettingsSearch } from "./match-link.js";
import {
  SHA_PREFIX,
  challengeFromReplay,
  encodeChallenge,
  decodeChallenge,
  readChallenge,
  challengeFragment,
} from "./challenge-link.js";
import { digest } from "../sim/index.js";
import { track, trackPage } from "./analytics.js";
import {
  MatchRecorder,
  recordingSupported,
  recordingFilename,
  introCard,
  matchOutcome,
  INTRO_SECONDS,
  OUTRO_SECONDS,
} from "./recorder.js";
import { MatchAudio } from "./audio.js";
import { CONTRACT_CARD, CONTROLLERS, HAZARD_CARDS, RULE_CARDS, RULES_NOTE, TABS, ruleCards, tabForRoute } from "../site/content.js";
import { currentRoute, pagePath, siteUrl } from "./base.js";
const icons = {
  arena: "M4 7 12 3l8 4v10l-8 4-8-4V7Zm0 0 8 4 8-4M12 11v10",
  code: "m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18",
  trophy:
    "M8 3h8v8a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 3v6m-4 0h8",
  book: "M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Zm0 14h16M8 7h8m-8 4h6",
  play: "m8 4 12 8-12 8V4Z",
  pause: "M8 4v16M16 4v16",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4",
  reset: "M3 10a9 9 0 1 1 1 7M3 4v6h6",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7Z",
  check: "m4 12 5 5L20 6",
  close: "m5 5 14 14M19 5 5 19",
  plus: "M12 4v16M4 12h16",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  swap: "M4 7h16l-4-4M20 17H4l4 4",
  record: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
  sound: "M4 9h4l5-4v14l-5-4H4V9Zm12 0a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12",
  mute: "M4 9h4l5-4v14l-5-4H4V9Zm12 1 6 6m0-6-6 6",
  stop: "M6 6h12v12H6Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5m-1.5 3.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5",
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] ?? icons.arena}"/></svg>`;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const bots = [...builtins];
const tournamentReplays = new Map();
const heldKeys = new Set();
const CONTROL_KEYS = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  "touch:forward": "forward", "touch:back": "back",
  "touch:left": "left", "touch:right": "right",
};
const coarsePointer = () => matchMedia("(pointer: coarse)").matches;
let replay = null,
  liveReplay = null,
  liveActive = false,
  previousReplay = null,
  // The replay rebuilt from a challenge link, and the settings to beat it.
  challengeReplay = null,
  challengeSettings = null,
  viewer = null,
  worker = null,
  operation = null,
  report = null,
  lastFrame = null,
  recorder = null,
  recorderStop = null,
  introStart = null,
  introTimer = null;
const $ = (s) => document.querySelector(s);
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const download = (name, data, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// The panel a link asked for. Everything after that is switched in place.
const initialTab = tabForRoute(currentRoute()) ?? TABS[0];
const shown = (tab) => (tab === initialTab.id ? "" : " hidden");
document.querySelector("#app").innerHTML = `
<header class="header">
 <a class="brand" href="${pagePath("")}" aria-label="llms-robot-arena, home"><span class="brand-mark" aria-hidden="true">R<span>↗</span></span><span>llms-<span class="brand-second">robot-arena</span></span></a>
 <nav aria-label="Main navigation">${TABS.map(
   (tab) =>
     `<a class="nav-button ${tab.id === initialTab.id ? "selected" : ""}" data-tab="${tab.id}" href="${pagePath(tab.route)}" aria-current="${tab.id === initialTab.id ? "page" : "false"}">${icon(tab.icon)}<span>${tab.label}</span></a>`,
 ).join("")}</nav>
 <div class="header-end"><span class="version">SPEC ${SPEC_VERSION.replace("-draft", "")} </span></div>
</header>
<main>
 <section id="panel-arena" class="panel"${shown("arena")}>
  <div class="page-heading"><div><div class="eyebrow">AUTONOMOUS COMBAT LAB <span>/ 01</span></div><h1>The arena decides<span>.</span></h1></div><div class="heading-actions"><select id="replay-library" aria-label="Local tournament replays" hidden><option value="">Tournament replays…</option></select><button id="import-replay" class="button outline">${icon("upload")}Import replay</button><button id="record" class="button outline" disabled>${icon("record")}Record video</button><button id="export-replay" class="button outline" disabled>${icon("download")}Export replay</button><input type="file" id="replay-file" accept=".json,application/json" hidden></div></div>
  <div class="arena-layout">
   <div class="match-surface">
    <div class="stage" id="stage">
     <div class="stage-header"><div class="record-tag"><span class="record-dot"></span><span id="record-label">REPLAY</span> <span id="replay-seed">SEED 00</span></div><div class="stage-clock"><b id="match-clock">00:00</b><span>/ 02:00</span></div><span class="arena-size" id="arena-size">16.0 × 16.0 M</span></div>
     <div id="viewport"></div>
     <div class="stage-note"><span id="pressure-tag">RAISED PLATFORM</span><span id="camera-hint">Auto camera · follows both robots</span><span id="collapse-warning" role="status" aria-live="polite" hidden></span></div>
     <div class="camera-actions"><select id="camera-view" aria-label="Camera view" aria-describedby="camera-hint"><option value="auto">Auto camera</option></select><label class="camera-toggle"><input id="manual-camera" type="checkbox" aria-describedby="camera-hint">Manual camera</label><button id="sound" class="icon-button" aria-label="Mute sound" title="Sound" aria-pressed="true">${icon("sound")}</button><button id="reset-camera" class="icon-button" aria-label="Reset camera" title="Reset camera">${icon("reset")}</button><button id="fullscreen" class="icon-button" aria-label="Fullscreen" title="Fullscreen">${icon("expand")}</button></div>
     <div id="stage-loading" class="stage-loading"><span class="loader"></span><b>Preparing replay</b><span id="loading-detail">Simulation comes before every frame.</span><progress id="simulation-progress" value="0" max="1"></progress><button id="cancel" class="button outline" hidden>Cancel</button></div>
     <div id="result-banner" class="result-banner" hidden><span id="result-label" class="eyebrow">MATCH COMPLETE</span><strong id="result-title"></strong><span id="result-reason"></span><div id="result-standings" class="result-standings" hidden></div><div class="result-actions"><button id="beat-challenge" class="button accent" hidden>${icon("bolt")}Beat this replay</button><button id="watch-again" class="button accent">${icon("reset")}Watch again</button><button id="copy-challenge" class="button outline" hidden>${icon("link")}Copy challenge link</button><button id="random-match" class="button outline">${icon("swap")}Random seed</button></div></div>
     <div id="match-intro" class="match-intro" aria-hidden="true" hidden></div>
     <div id="live-hud" class="live-hud" hidden><strong>YOU DRIVE ROBOT A</strong><span class="keys"><b>W</b> <b>S</b> thrust · <b>A</b> <b>D</b> turn</span><button id="live-stop" class="button quiet">Leave match</button></div>
     <div id="touch-pad" class="touch-pad" hidden><div class="touch-group"><button data-control="left" aria-label="Turn left">&#9664;</button><button data-control="right" aria-label="Turn right">&#9654;</button></div><div class="touch-group"><button data-control="back" aria-label="Reverse">&#9660;</button><button data-control="forward" aria-label="Thrust forward">&#9650;</button></div></div>
    </div>
    <div class="playback"><button id="step-back" class="icon-button" aria-label="Previous frame" title="Previous frame (←)">‹</button><button id="play" class="play-button" aria-label="Play" disabled>${icon("play", 20)}</button><button id="step-forward" class="icon-button" aria-label="Next frame" title="Next frame (→)">›</button><span id="elapsed" class="mono">00:00</span><div class="scrubber"><div id="event-marks"></div><input type="range" id="timeline" aria-label="Replay position" min="0" max="120" step="any" value="0" disabled></div><span id="duration" class="mono secondary">02:00</span><select id="speed" aria-label="Playback speed"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></div>
    <div class="terrain-legend" aria-label="Arena cells"><span><i class="legend-recharge"></i>Recharge +60</span><span><i class="legend-hole"></i>Hole: instant loss</span><span><i class="legend-flame"></i>Grate: warning then flame</span><span><i class="legend-wear"></i>Cracks: weight damage</span><span><i class="legend-collapse"></i>Red flash: floor collapse</span></div>
    <div class="robot-stats" id="robot-stats"></div>
   </div>
   <aside class="match-sidebar">
    <div class="side-head"><h2>Set up match</h2>${icon("settings")}</div>
    <div class="side-body"><label class="field-label" for="bot-a"><span class="color-square a"></span>ROBOT A</label><select id="bot-a" class="bot-select"></select><label class="field-label" for="bot-b"><span class="color-square b"></span>ROBOT B</label><select id="bot-b" class="bot-select"></select>
     <div class="seed-row"><div><label for="seed" class="field-label">SEED</label><input id="seed" type="number" min="0" max="4294967295" step="1" value="0"></div><div><label for="spawn" class="field-label">SPAWN</label><select id="spawn"><option value="normal">Standard</option><option value="mirror">Mirrored</option></select></div></div>
     <button id="simulate" class="button accent run-button">${icon("play")}Simulate match${icon("arrow")}</button><p class="field-note">The entire match is computed before playback.</p>
     <button id="play-manual" class="button outline run-button">${icon("bolt")}Play yourself vs Robot B${icon("arrow")}</button><p class="field-note">Manual matches run in real time with the keyboard. Your inputs are logged with the replay, so it can be reproduced and shared. Never ranked.</p>
     <button id="rumble" class="button outline run-button">${icon("trophy")}Royal rumble: everyone in${icon("arrow")}</button><p class="field-note">Up to twelve controllers spawn in the same arena and the last one standing wins; with more in the catalog, the seed draws twelve. Controllers still see one opponent, the closest. Rumbles are exhibitions and are never ranked.</p>
    </div>
    <div class="mode-box"><span class="eyebrow">CURRENT MODE</span><div><span class="mode-symbol">E</span><strong id="current-mode">Local exhibition</strong></div><p id="mode-note">Exhibitions use a deterministic budget. Controller provenance is recorded in each replay.</p></div>
    <div class="event-section"><div class="side-head"><h2>Event log</h2><span class="count" id="event-count">0</span></div><div id="event-log" class="event-log"><p class="empty-note">Events will appear during playback.</p></div></div>
    
   </aside>
  </div>
  <div class="arena-footer"><span><i></i>60 HZ PHYSICS</span><span>100 KG / ROBOT</span><span id="control-tag">NO MANUAL CONTROL</span><span id="hash-label">SHA-256 · HASH EVERY 60 TICKS</span></div>
 </section>
 <section id="panel-lab" class="panel"${shown("lab")}>
  <div class="page-heading"><div><div class="eyebrow">CONTROLLER WORKSPACE <span>/ 02</span></div><h1>Your code. Your robot<span>.</span></h1></div><button id="new-bot" class="button accent">${icon("plus")}New controller</button></div>
  <div class="lab-layout"><div class="editor-panel"><div class="editor-toolbar"><select id="edit-bot" aria-label="Controller to edit"></select></div><div class="editor-file">${icon("code", 16)}<span id="editor-filename">controller.js</span><span id="unsaved" class="unsaved" hidden>Unsaved changes</span></div><div class="editor-body"><pre id="line-numbers" aria-hidden="true"></pre><textarea id="code-editor" aria-label="Controller source" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div><div class="editor-footer"><input id="bot-name" aria-label="Model name" placeholder="Model name" maxlength="80"><select id="bot-provider" aria-label="Model provider"><option value="">No provider</option><option>OpenAI</option><option>Anthropic</option></select><button id="download-bot" class="button outline">${icon("download")}.js file</button><button id="save-bot" class="button accent">Save controller</button></div></div>
   <aside class="lab-sidebar"><div class="info-card">${CONTRACT_CARD}</div><div class="info-card gate-card"><div class="eyebrow">CONFORMANCE GATE</div><h2>Validate the contract.</h2><p>200 snapshots and 600 inert ticks. These checks offer no combat advice.</p><button id="run-gate" class="button outline full-width">${icon("check")}Check controller</button><div id="gate-results" aria-live="polite"></div></div><p class="side-hint">Edits here are iterative experimentation. For a one-shot benchmark, follow AGENTS.md and use the project CLI.</p></aside>
  </div>
 </section>
 <section id="panel-tournament" class="panel"${shown("tournament")}>
  <div class="page-heading"><div><div class="eyebrow">TOURNAMENT <span>/ 03</span></div><h1>Earn your ranking<span>.</span></h1></div><div class="heading-actions"><button id="export-report" class="button outline" disabled>${icon("download")}.md report</button><button id="export-ranking" class="button outline" disabled>${icon("download")}Export results</button></div></div>
  <div class="tournament-setup"><div><span class="eyebrow">EXHIBITION TOURNAMENT</span><h2>More action. Fewer matches.</h2><label class="field-label" for="tournament-format">FORMAT</label><select id="tournament-format"><option value="quick">Quick rounds (up to 3 rounds)</option><option value="round-robin">Full round robin (20 matches per pair)</option></select><p id="tournament-description"></p><div id="tournament-bots" class="bot-checks"></div></div><button id="run-tournament" class="button accent">${icon("trophy")}Start tournament</button></div>
  <div id="tournament-progress" class="tournament-progress" hidden><div><strong id="tournament-status">Checking controllers…</strong><button id="cancel-tournament" class="button quiet">Cancel</button></div><progress max="1" value="0"></progress></div>
  <div id="tournament-gates" aria-label="Tournament controller checks" hidden></div>
  <div id="ranking-surface" class="ranking-surface"><div class="empty-ranking"><span>${icon("trophy", 44)}</span><h2>No verdict yet.</h2><p>Select at least two controllers and start the tournament.<br>Results and provisional rankings update after every match.</p></div></div>
  <div id="tournament-style" class="style-grid"></div>
  <div id="tournament-code" class="tournament-matches"></div>
  <div id="tournament-index" class="tournament-matches"></div>
  <div id="tournament-matches" class="tournament-matches"></div>
  <p class="tournament-note">Regularized Bradley–Terry: mean strength = 100. Quick rounds sample different opponents with one seed and both spawns per pairing; they do not estimate confidence intervals. Full round robin adds 95% seed-bootstrap intervals when complete. Results remain provisional while running or after cancellation. Completed replays stay available until the next tournament or page reload. Browser results are exhibitions; the standard evaluation protocol is available through the CLI. The published standings shown when this page opens come from a repository run; starting a tournament replaces them with your own results.</p>
 </section>
 <section id="panel-rules" class="panel"${shown("rules")}>
  <div class="page-heading"><div><div class="eyebrow">SPEC ${SPEC_VERSION.replace("-draft", "")} <span>/ 04</span></div><h1>Same hardware. Different minds<span>.</span></h1></div></div>
  <div class="rules-grid">${ruleCards(RULE_CARDS)}</div>
  <div class="rules-grid hazard-rules">${ruleCards(HAZARD_CARDS)}</div>
  <div class="review-note"><strong>${RULES_NOTE.title}</strong><p>${RULES_NOTE.body}</p></div>
 </section>
</main><footer class="footer"><span><a href="https://github.com/nigrosimone/llms-robot-arena" title="View llms-robot-arena on GitHub">llms-robot-arena</a></span><nav class="footer-links" aria-label="Reference pages"><a href="${pagePath(CONTROLLERS.route)}">${CONTROLLERS.label}</a></nav><span>Code makes the difference.</span><span>ENGINE ${ENGINE_VERSION}</span><span>Cookie-free analytics</span></footer><div id="toast" role="status" aria-live="polite" hidden></div>`;
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 5500);
}
function refreshBotOptions() {
  for (const id of ["bot-a", "bot-b", "edit-bot"]) {
    const el = $("#" + id),
      value = el.value;
    el.innerHTML = sortedBotOptions(bots)
      .map(({ bot: b, index: i }) => `<option value="${i}">${esc(botName(b))} / ${esc(botDetails(b))}</option>`)
      .join("");
    el.value = value || "0";
  }
  const checked = new Set([...document.querySelectorAll("#tournament-bots input:checked")].map(input => input.value));
  const first = !$("#tournament-bots").children.length;
  $("#tournament-bots").innerHTML = sortedBotOptions(bots)
    .map(
      ({ bot: b, index: i }) =>
        `<label class="bot-checkbox"><input type="checkbox" value="${i}" ${first || checked.has(String(i)) ? "checked" : ""}><span>${esc(botName(b))}<small class="bot-provider">${esc(botDetails(b))}</small></span></label>`,
    )
    .join("");
  updateTournamentFormat();
}
refreshBotOptions();
renderRobotCards(builtins.slice(0, 2));
$("#bot-b").value = "1";
// Each panel has its own address. Switching one pushes it, so the back button
// and a shared link land on the same panel, and nothing is simulated twice.
function selectTab(id, { push = false } = {}) {
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  document
    .querySelectorAll(".panel")
    .forEach((p) => (p.hidden = p.id !== "panel-" + tab.id));
  document.querySelectorAll("[data-tab]").forEach((link) => {
    const selected = link.dataset.tab === tab.id;
    link.classList.toggle("selected", selected);
    link.setAttribute("aria-current", selected ? "page" : "false");
  });
  document.title = tab.title;
  if (push) {
    history.pushState(null, "", pagePath(tab.route) + location.search + location.hash);
    trackPage(pagePath(tab.route));
  }
  if (tab.id === "arena") armArena();
}
addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-tab]");
  // Modified clicks belong to the browser: a new tab must still get the page.
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  selectTab(link.dataset.tab, { push: true });
});
addEventListener("popstate", () =>
  selectTab((tabForRoute(currentRoute()) ?? TABS[0]).id),
);
// One card per robot: a duel keeps two, a rumble grows the grid.
function renderRobotCards(entries) {
  $("#robot-stats").classList.toggle("many", entries.length > 2);
  $("#robot-stats").innerHTML = entries
    .map(
      (bot, i) => `<article class="robot-card robot-${i}" style="--robot:${robotColor(i).css}"><div class="robot-ident"><span class="robot-avatar">${icon("arena", 26)}</span><div><span class="eyebrow">ROBOT ${String.fromCharCode(65 + i)}</span><h2 id="robot-name-${i}">${esc(botName(bot))}</h2><span class="bot-provider" id="robot-provider-${i}">${esc(botDetails(bot))}</span></div><span id="robot-status-${i}" class="status-tag">ACTIVE</span></div><div class="energy-row"><span>${icon("bolt", 14)}Energy</span><strong><span id="energy-${i}">${S.ENERGY_MAX}</span><small> / <span id="energy-max-${i}">${S.ENERGY_MAX}</span></small></strong></div><div class="energy-track"><span id="energy-bar-${i}" style="width:100%"></span></div><div class="robot-bottom"><span>Flips taken</span><div class="flip-pips" id="flips-${i}"><i></i><i></i><b>0 / 2</b></div></div></article>`,
    )
    .join("");
}
function renderFrame(frame) {
  lastFrame = frame;
  const { time, states, half, events, ended } = frame;
  $("#match-clock").textContent = clock(time);
  $("#elapsed").textContent = clock(time);
  $("#timeline").value = time;
  const playLabel = frame.playing ? "Pause" : "Play";
  if ($("#play").getAttribute("aria-label") !== playLabel) {
    $("#play").innerHTML = icon(frame.playing ? "pause" : "play", 20);
    $("#play").setAttribute("aria-label", playLabel);
  }
  $("#arena-size").textContent =
    `${(half * 2).toFixed(1)} × ${(half * 2).toFixed(1)} M`;
  $("#pressure-tag").textContent =
    time >= 60 ? "SUDDEN DEATH · ARENA SHRINKING" : "RAISED PLATFORM";
  $("#pressure-tag").classList.toggle("pressure", time >= 60);
  const collapsing = (frame.cells ?? []).filter(c => c.collapseIn != null);
  const alert = $("#collapse-warning");
  alert.hidden = collapsing.length === 0;
  if (collapsing.length) {
    const message = `FLOOR COLLAPSE IN ${Math.ceil(Math.min(...collapsing.map(c => c.collapseIn)))} S`;
    if (alert.textContent !== message) alert.textContent = message;
  }
  states.forEach((r, i) => {
    const energy = r.energy.toFixed(1);
    $("#energy-" + i).textContent = energy;
    const energyMax = replay?.energyMax ?? 100;
    $("#energy-max-" + i).textContent = energyMax;
    $("#energy-bar-" + i).style.width = (r.energy / energyMax * 100) + "%";
    $("#energy-bar-" + i).classList.toggle("low", r.energy < energyMax * 0.2);
    $("#robot-status-" + i).textContent = r.hole ? "FELL THROUGH" : r.ringOut ? "RING-OUT" : ["ACTIVE", "FLIPPED", "RECOVERING", "OUT"][r.status];
    $("#robot-status-" + i).classList.toggle("danger", r.status === 1 || r.ringOut || r.out);
    $("#robot-status-" + i).classList.toggle("recovering", r.status === 2);
    $("#flips-" + i).innerHTML =
      `<i class="${r.flips > 0 ? "filled" : ""}"></i><i class="${r.flips > 1 ? "filled" : ""}"></i><b>${r.flips} / 2</b>`;
  });
  const notable = events.filter(
    (e) => e.type !== "impact" || e.closingSpeed > 0.3,
  );
  $("#event-count").textContent = notable.length;
  const signature = notable.length + ":" + (notable.at(-1)?.tick ?? -1);
  if ($("#event-log").dataset.signature !== signature) {
    $("#event-log").dataset.signature = signature;
    $("#event-log").innerHTML = notable.length
      ? notable
          .slice(-12)
          .reverse()
          .map((e) => {
            const label =
              e.type === "collapse-warning"
                ? `Floor cell ${e.cell} unstable${e.cause === "weight" ? " under robot weight" : ""}: 3-second warning`
                : e.type === "collapse"
                  ? `Floor cell ${e.cell} collapsed${e.cause === "weight" ? " under robot weight" : ""}`
                : e.type === "impact"
                ? `Impact · ${e.closingSpeed.toFixed(1)} m/s`
                : e.type === "flip"
                  ? `${botName(replay.bots[e.robot])} flipped`
                  : e.type === "ring-out"
                    ? `${botName(replay.bots[e.robot])} out of the arena`
                    : e.type === "hole"
                      ? `${botName(replay.bots[e.robot])} fell through a hole`
                    : e.type === "recharge"
                      ? `${botName(replay.bots[e.robot])} recharged +${e.amount.toFixed(1)}`
                    : e.type === "fire-damage"
                      ? `${botName(replay.bots[e.robot])} taking fire damage`
                    : e.type === "eliminated"
                      ? `${botName(replay.bots[e.robot])} is out (${e.reason})`
                    : e.type === "recovery"
                      ? `${botName(replay.bots[e.robot])} self-rights`
                      : e.type === "violation"
                        ? `${botName(replay.bots[e.robot])}: ${e.reason}`
                        : "Engine violation";
            return `<button class="event-row" data-time="${(e.tick + 1) / 60}"><span class="event-symbol ${e.type}">${e.type === "impact" ? "×" : e.type === "flip" ? "↻" : "·"}</span><span>${esc(label)}</span><time>${clock((e.tick + 1) / 60)}</time></button>`;
          })
          .join("")
      : '<p class="empty-note">Waiting for first contact.</p>';
  }
  $("#result-banner").hidden = !ended;
  if (ended && replay) {
    const outcome = matchOutcome(replay);
    $("#result-title").textContent = outcome.title;
    $("#result-standings").hidden = !replay.result.standings;
    if (replay.result.standings)
      $("#result-standings").innerHTML = replay.result.standings
        .map((robot, place) => `<span><b>${place + 1}</b>${esc(botName(replay.bots[robot]))}</span>`)
        .join("");
    $("#result-reason").textContent =
      outcome.reason + " · " + clock(viewer.duration);
    $("#copy-challenge").hidden = !shareableChallenge(replay);
    $("#beat-challenge").hidden = replay !== challengeReplay;
    if (recorder?.recording && recorderStop === null)
      recorderStop = setTimeout(finishRecording, OUTRO_SECONDS * 1000);
  }
  const lastHash = replay?.stateHashes
    .filter((h) => h.tick <= time * 60)
    .at(-1);
  $("#hash-label").textContent = lastHash
    ? "SHA-256 " + lastHash.hash.slice(0, 12) + "…"
    : "SHA-256 · HASH EVERY 60 TICKS";
}
function renderEventMarks(r) {
  $("#event-marks").innerHTML = r.events
    .filter((e) => ["flip", "ring-out", "hole", "recharge", "collapse-warning", "collapse", "eliminated"].includes(e.type))
    .map(
      (e) =>
        `<span class="mark-${e.type}" style="left:${((e.tick + 1) / r.result.ticks) * 100}%" title="${e.type}"></span>`,
    )
    .join("");
}
function loadReplay(r, autoplay = false) {
  delete $("#event-log").dataset.signature;
  replay = r;
  if (viewer) $("#stage-loading").hidden = true;
  $("#result-banner").hidden = true;
  $("#play").disabled = false;
  $("#timeline").disabled = false;
  $("#export-replay").disabled = false;
  $("#record").disabled = !viewer || !recordingSupported();
  $("#timeline").max = r.result.ticks / 60;
  $("#duration").textContent = clock(r.result.ticks / 60);
  $("#replay-seed").textContent =
    `SEED ${String(r.seed).padStart(2, "0")} ${r.mirrored ? "· M" : ""}`;
  renderRobotCards(r.bots);
  renderCameraViews(r.bots);
  $("#current-mode").textContent =
    r.mode === "one-shot"
      ? "One-shot benchmark"
      : r.mode === "iterative"
        ? "Iterative benchmark"
        : r.mode === "manual"
          ? "Manual duel"
          : r.mode === "rumble"
            ? "Royal rumble"
            : "Local exhibition";
  $("#mode-note").textContent = r.mode === "manual"
    ? "A human drove one robot in real time. The logged inputs reproduce the match from its seed; it is never ranked."
    : `${r.runtime?.budgetMode === "wall" ? "2 ms wall-clock budget." : "Deterministic instruction budget."} ${r.mode === "exhibition" ? "Exhibition of the selected controllers. Provenance is recorded in exported metadata." : "See exported metadata for provenance."}`;
  renderEventMarks(r);
  viewer?.load(r);
  if (viewer) {
    if (autoplay) playWithIntro();
    else viewer.playing = false;
  } else {
    $("#stage-loading b").textContent =
      "Replay ready. 3D graphics unavailable.";
    $("#loading-detail").textContent =
      "Export the replay or open it in a browser with WebGL 2.";
    $("#play").disabled = true;
    $("#timeline").disabled = true;
  }
}
// Sound is synthesized in the browser and mixed into the recorded clip. A
// browser only lets it start after an interaction, and the first match plays
// on its own, so any gesture on the page wakes it. The sound button is left
// out: a click there must not both wake the sound and mute it.
const audio = new MatchAudio();
const wakeAudio = (event) => {
  if (!event.target?.closest?.("#sound")) audio.resume();
};
addEventListener("pointerdown", wakeAudio, true);
addEventListener("keydown", wakeAudio, true);
try {
  viewer = new ArenaViewer($("#viewport"), renderFrame);
  viewer.audio = audio;
} catch (e) {
  $("#stage-loading b").textContent = "WebGL 2 is unavailable.";
  $("#loading-detail").textContent =
    "You can create controllers, simulate matches and export replays. To use the viewer, open a browser with hardware acceleration.";
  $("#simulation-progress").hidden = true;
  $("#stage-loading .loader").hidden = true;
  toast("Could not start 3D graphics.", true);
}
// A few seconds of card before the action: who is fighting, on screen and in
// the recorded video, then playback starts on its own.
function showIntro(r) {
  const card = introCard(r);
  const fighters =
    card.robots.length > 2
      ? `<div class="intro-roster">${card.robots
          .map(
            (robot) =>
              `<b style="--robot:${robot.color}">${esc(robot.name)}</b>`,
          )
          .join("")}</div>`
      : card.robots
          .map(
            (robot, i) =>
              `<div class="intro-fighter ${i ? "b" : "a"}" style="--robot:${robot.color}"><span>${esc(robot.label)}</span><b>${esc(robot.name)}</b><small>${esc(robot.provider)}</small></div>`,
          )
          .join('<span class="intro-versus">VS</span>');
  $("#match-intro").innerHTML =
    `<span class="intro-eyebrow">AUTONOMOUS COMBAT LAB</span><span class="intro-title">${esc(card.title)}</span>${fighters}<span class="intro-seed">${esc(card.seed)}</span>`;
  $("#match-intro").hidden = false;
  introStart = performance.now();
  audio.intro = true;
}
function cancelIntro() {
  clearTimeout(introTimer);
  introTimer = null;
  introStart = null;
  audio.intro = false;
  $("#match-intro").hidden = true;
}
function playWithIntro() {
  if (!viewer || !replay) return;
  cancelIntro();
  viewer.playing = false;
  viewer.seek(0);
  audio.restartTrack();
  showIntro(replay);
  introTimer = setTimeout(() => {
    cancelIntro();
    if (viewer) viewer.playing = true;
  }, INTRO_SECONDS * 1000);
}
function setRecordingUI(active) {
  $("#record").innerHTML = active
    ? `${icon("stop")}Stop and save`
    : `${icon("record")}Record video`;
  $("#record").classList.toggle("recording", active);
  $("#record-label").textContent = active ? "REC" : liveActive ? "LIVE" : "REPLAY";
}
function recorderState() {
  return {
    replay,
    frame: lastFrame,
    duration: viewer?.duration ?? 0,
    intro:
      introStart === null
        ? null
        : Math.min(1, (performance.now() - introStart) / (INTRO_SECONDS * 1000)),
  };
}
function startRecording() {
  if (!viewer || !replay) return toast("Simulate or import a match first.", true);
  if (!recordingSupported())
    return toast("This browser cannot record video.", true);
  audio.resume();
  recorder = new MatchRecorder({
    source: () => viewer.renderer.domElement,
    state: recorderState,
    sound: audio.stream,
  });
  try {
    recorder.start();
  } catch (error) {
    recorder = null;
    return toast(error.message, true);
  }
  viewer.onRender = () => recorder?.capture();
  setRecordingUI(true);
  playWithIntro();
  toast("Recording from the start. The video is saved when the match ends.");
}
async function finishRecording() {
  clearTimeout(recorderStop);
  recorderStop = null;
  const active = recorder;
  recorder = null;
  if (!active?.recording) return;
  setRecordingUI(false);
  $("#record").disabled = true;
  const clip = await active.stop();
  if (viewer) viewer.onRender = null;
  $("#record").disabled = false;
  if (!clip?.blob.size) return toast("Recording produced no video.", true);
  const name = recordingFilename(replay, clip.extension);
  download(name, clip.blob, clip.blob.type);
  track("video-exported", clip.extension);
  toast("Video saved: " + name);
}
// A new match cancels a running intro and closes the clip already recorded.
function interruptPlayback() {
  cancelIntro();
  if (recorder?.recording) finishRecording();
}
$("#record").onclick = () =>
  recorder?.recording ? finishRecording() : startRecording();
$("#play").onclick = () => {
  cancelIntro();
  viewer?.toggle();
};
$("#watch-again").onclick = playWithIntro;
$("#timeline").oninput = (e) => {
  cancelIntro();
  viewer?.seek(+e.target.value);
};
$("#speed").onchange = (e) => {
  if (viewer) viewer.speed = +e.target.value;
};
$("#reset-camera").onclick = () => viewer?.resetCamera();
function renderSoundButton() {
  const button = $("#sound"),
    on = audio.audible;
  button.innerHTML = icon(on ? "sound" : "mute");
  button.setAttribute("aria-pressed", String(on));
  button.setAttribute("aria-label", on ? "Mute sound" : "Unmute sound");
  button.classList.toggle("muted", !on);
}
audio.onchange = renderSoundButton;
renderSoundButton();
// Blocked sound is not muted sound: the first click here turns it on.
$("#sound").onclick = () => audio.setEnabled(!audio.audible);
// One entry per robot: watching the match from behind it, with every robot
// still in the shot.
function renderCameraViews(roster = [], selected = "auto") {
  $("#camera-view").innerHTML =
    '<option value="auto">Auto camera</option>' +
    roster
      .map((bot, i) => `<option value="${i}">View from ${esc(botName(bot))}</option>`)
      .join("");
  $("#camera-view").value = String(selected);
  updateCameraHint();
}
function updateCameraHint() {
  const view = $("#camera-view").value;
  $("#camera-hint").textContent = $("#manual-camera").checked
    ? "Drag to orbit · right-drag to pan · scroll or pinch to zoom"
    : view === "auto"
      ? "Auto camera · follows every robot"
      : `Behind ${$("#camera-view").selectedOptions[0].textContent.replace("View from ", "")} · its closest rival stays in frame`;
}
$("#camera-view").disabled = !viewer;
$("#camera-view").onchange = (e) => {
  viewer?.setCameraView(e.target.value === "auto" ? "auto" : Number(e.target.value));
  updateCameraHint();
};
$("#manual-camera").disabled = !viewer;
$("#manual-camera").onchange = (e) => {
  viewer?.setManualCamera(e.target.checked);
  $("#camera-view").disabled = e.target.checked || !viewer;
  updateCameraHint();
};
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#stage").requestFullscreen();
  } catch {
    toast("Fullscreen is unavailable in this browser.");
  }
};
$("#event-log").onclick = (e) => {
  const row = e.target.closest("[data-time]");
  if (row) viewer?.seek(+row.dataset.time);
};
function setBusy(busy) {
  document
    .querySelectorAll("#simulate,#play-manual,#run-gate,#run-tournament")
    .forEach((b) => (b.disabled = busy));
  document.querySelectorAll("#tournament-bots input,#tournament-format")
    .forEach(el => { el.disabled = busy; });
}
function startOperation(type, data) {
  if (worker) return toast("Wait for the current operation or cancel it.");
  operation = type;
  setBusy(true);
  worker = new Worker(new URL("./match-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      if (operation === "match" || operation === "resimulate") {
        $("#simulation-progress").value = data.progress;
        $("#loading-detail").textContent =
          `Simulation ${Math.round(data.progress * 100)}% · ${clock(data.progress * 120)} / 02:00`;
      } else if (operation === "tournament") {
        $("#tournament-progress progress").value = data.progress;
        $("#tournament-status").textContent =
          data.message ?? `${data.completed} / ${data.total} matches completed · Round ${data.round} / ${data.rounds} · ${data.pairing.map(botName).join(" vs ")}`;
      }
      return;
    }
    if (data.type === "live-start") {
      beginLiveMatch(data);
      return;
    }
    if (data.type === "live-tick") {
      appendLiveTick(data);
      return;
    }
    if (data.type === "live-end") finishLiveMatch(data.replay);
    if (data.type === "live-aborted") abortLiveMatch();
    if (data.type === "tournament-gate") {
      renderTournamentGate(data.bot, data.gate);
      return;
    }
    if (data.type === "tournament-update") {
      report = data.report;
      if (data.replay) tournamentReplays.set(report.records.length - 1, data.replay);
      renderRanking();
      renderTournamentMatches();
      return;
    }
    if (data.type === "error") {
      if (operation === "tournament" && report) report.status = "failed";
      toast(data.message, true);
      if (operation === "gate")
        $("#gate-results").innerHTML =
          `<p class="gate-fail">${esc(data.message)}</p>`;
    }
    if (data.type === "replay") {
      loadReplay(data.replay, true);
      if (operation === "resimulate") {
        challengeReplay = data.replay;
        toast("Challenge rebuilt from its input log. Beat it after the replay.");
      } else toast("Match computed. The replay is ready.");
    }
    if (data.type === "gate") {
      renderGate(data.gate);
    }
    if (data.type === "tournament") {
      report = data.report;
      renderRanking();
      $("#tournament-progress progress").value = 1;
      $("#tournament-status").textContent = `Tournament complete · ${report.records.length} matches`;
      toast("Tournament complete.");
    }
    finishOperation();
  };
  worker.onerror = (e) => {
    if (operation === "tournament" && report) report.status = "failed";
    toast(e.message || "An error occurred during execution.", true);
    finishOperation();
  };
  worker.postMessage({ type, ...data });
}
function finishOperation() {
  worker?.terminate();
  worker = null;
  setBusy(false);
  $("#cancel").hidden = true;
  if (viewer) $("#stage-loading").hidden = true;
  if (operation === "live") {
    if (liveReplay) abortLiveMatch();
    setLiveUI(false);
  }
  if (operation === "tournament") {
    $("#cancel-tournament").hidden = true;
    if (report) {
      if (report.status === "running") report.status = "cancelled";
      renderRanking();
      $("#tournament-status").textContent = `Tournament ${report.status} · ${report.records.length} / ${report.totalMatches} matches completed`;
    } else $("#tournament-status").textContent = "Tournament stopped before any matches were played.";
  }
  operation = null;
}
function cancelOperation() {
  if (worker) {
    worker.postMessage({ type: "cancel" });
    toast("Operation canceled.");
  }
}
$("#cancel").onclick = cancelOperation;
$("#cancel-tournament").onclick = cancelOperation;
// The address describes what is on the stage; the channel tag of the visit stays.
function updateUrl({ search = "", hash = "" }) {
  const url = new URL(location.href);
  const ref = url.searchParams.get("ref");
  url.search = search;
  url.hash = hash;
  if (ref) url.searchParams.set("ref", ref);
  history.replaceState(null, "", url);
}
function simulateMatch() {
  const value = Number($("#seed").value);
  if (!Number.isInteger(value) || value < 0 || value > 4294967295)
    return toast("Enter an integer seed between 0 and 4294967295.", true);
  interruptPlayback();
  if (viewer) viewer.playing = false;
  $("#stage-loading").hidden = false;
  $("#stage-loading b").textContent = "Computing match";
  $("#loading-detail").textContent = "Starting the two isolated controllers…";
  $("#simulation-progress").value = 0;
  $("#cancel").hidden = false;
  $("#result-banner").hidden = true;
  const a = +$("#bot-a").value,
    b = +$("#bot-b").value,
    mirrored = $("#spawn").value === "mirror";
  // Only registered controllers can be reloaded from a link; local ones exist in this tab alone.
  updateUrl({
    search: a < builtins.length && b < builtins.length
      ? matchSettingsSearch({ a: bots[a].id, b: bots[b].id, seed: value, mirrored })
      : "",
  });
  startOperation("match", { bots: [bots[a], bots[b]], seed: value, mirrored });
}
$("#simulate").onclick = simulateMatch;
// Everyone at once: the same match runner, with the whole roster as robots.
function startRumble() {
  const value = Number($("#seed").value);
  if (!Number.isInteger(value) || value < 0 || value > 4294967295)
    return toast("Enter an integer seed between 0 and 4294967295.", true);
  if (bots.length < 3) return toast("A rumble needs at least three controllers.", true);
  // The arena holds twelve: a larger roster is drawn by the seed, so the same
  // seed gives the same rumble.
  const roster = bots.length > 12 ? drawRoster(bots, 12, value) : bots;
  interruptPlayback();
  if (viewer) viewer.playing = false;
  $("#stage-loading").hidden = false;
  $("#stage-loading b").textContent = "Computing rumble";
  $("#loading-detail").textContent = `Starting ${roster.length} isolated controllers…`;
  $("#simulation-progress").value = 0;
  $("#cancel").hidden = false;
  $("#result-banner").hidden = true;
  updateUrl({});
  if (roster !== bots) toast(`${bots.length} controllers: seed ${value} draws ${roster.length} of them.`);
  startOperation("match", { bots: roster, seed: value, mode: "rumble" });
}
function drawRoster(list, count, seed) {
  const order = [...list], random = mulberry32(seed ^ 0x72756d62);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count);
}
$("#rumble").onclick = startRumble;
$("#random-match").onclick = () => {
  // Same pairing, new draw: the seed decides spawn jitter and terrain layout.
  const manual = replay?.mode === "manual",
    rumble = replay?.mode === "rumble";
  const indexes = (replay?.bots ?? []).map((b) => bots.findIndex((c) => c.id === b.id));
  if (manual) {
    if (indexes[1] >= 0) $("#bot-b").value = String(indexes[1]);
  } else if (indexes.length === 2 && indexes.every((i) => i >= 0)) {
    $("#bot-a").value = String(indexes[0]);
    $("#bot-b").value = String(indexes[1]);
  }
  $("#seed").value = String(Math.floor(Math.random() * 4294967296));
  $("#spawn").value = Math.random() < 0.5 ? "normal" : "mirror";
  if (manual) startLiveMatch();
  else if (rumble) startRumble();
  else simulateMatch();
};
// Manual duel: the keyboard drives robot A, the selected controller drives B.
const LIVE_PLAYER = 0;
function setLiveUI(active) {
  liveActive = active;
  $("#live-hud").hidden = !active;
  $("#record-label").textContent = active ? "LIVE" : "REPLAY";
  $("#control-tag").textContent = active
    ? "MANUAL CONTROL · UNRANKED"
    : "NO MANUAL CONTROL";
  for (const id of ["#play", "#timeline", "#step-back", "#step-forward", "#speed", "#export-replay", "#import-replay"])
    $(id).disabled = active || !replay;
  $("#record").disabled = active || !replay || !recordingSupported();
  // The driver keeps their own camera: the view cannot be changed mid-match.
  $("#camera-view").disabled = active || !viewer || $("#manual-camera").checked;
  viewer?.setFocus(active ? LIVE_PLAYER : null);
  $("#touch-pad").hidden = !active || !coarsePointer();
  if (!active && heldKeys.size) heldKeys.clear();
}
function startLiveMatch() {
  const seed = Number($("#seed").value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    return toast("Enter an integer seed between 0 and 4294967295.", true);
  interruptPlayback();
  if (viewer) viewer.playing = false;
  previousReplay = liveActive ? previousReplay : replay;
  $("#stage-loading").hidden = false;
  $("#stage-loading b").textContent = "Starting manual match";
  $("#loading-detail").textContent = "Loading the opposing controller…";
  $("#simulation-progress").value = 0;
  $("#cancel").hidden = true;
  $("#result-banner").hidden = true;
  updateUrl({});
  startOperation("live", {
    bot: bots[+$("#bot-b").value],
    seed,
    mirrored: $("#spawn").value === "mirror",
    player: LIVE_PLAYER,
    control: coarsePointer() ? "touch" : "keyboard",
  });
  if (operation === "live") {
    setLiveUI(true);
    track("play-started", botName(bots[+$("#bot-b").value]));
  }
}
// The replay grows tick by tick while the match is played, so the viewer, the
// robot cards and the event log keep using the ordinary replay format.
function beginLiveMatch(data) {
  liveReplay = replay = {
    specVersion: SPEC_VERSION,
    engineVersion: ENGINE_VERSION,
    mode: "manual",
    seed: data.seed,
    mirrored: data.mirrored,
    bots: data.bots,
    dt: S.DT,
    energyMax: S.ENERGY_MAX,
    arenaCells: data.arenaCells,
    floorLoads: [],
    initialFrame: data.initialFrame,
    frames: new Float32Array(7200 * 12),
    arenaExtents: new Float32Array(7200),
    events: [],
    stateHashes: [],
    result: { winner: null, reason: "timeout", ticks: 0 },
    finalStates: [],
    violations: [0, 0],
    engineViolations: 0,
    runtime: {},
  };
  delete $("#event-log").dataset.signature;
  $("#event-marks").innerHTML = "";
  $("#replay-seed").textContent =
    `SEED ${String(data.seed).padStart(2, "0")} ${data.mirrored ? "· M" : ""}`;
  renderRobotCards(data.bots);
  renderCameraViews(data.bots, LIVE_PLAYER);
  $("#current-mode").textContent = "Manual duel";
  $("#mode-note").textContent =
    "You drive one robot in real time. Your inputs are logged with the replay, so it can be reproduced and shared.";
  $("#timeline").max = S.MATCH_DURATION;
  $("#duration").textContent = clock(S.MATCH_DURATION);
  $("#stage-loading").hidden = true;
  viewer?.load(liveReplay, { live: true });
  viewer?.setFocus(LIVE_PLAYER);
}
function appendLiveTick(data) {
  const r = liveReplay;
  if (!r || data.tick > 7200) return;
  r.frames.set(data.frame, (data.tick - 1) * 12);
  r.arenaExtents[data.tick - 1] = data.extent;
  r.floorLoads.push(...data.loads);
  if (data.cells?.length) r.arenaCells.push(...data.cells);
  r.events.push(...data.events);
  r.stateHashes.push(...data.hashes);
  r.result.ticks = data.tick;
}
function finishLiveMatch(final) {
  const r = liveReplay;
  liveReplay = null;
  if (!r) return loadReplay(final, true);
  // Keep the object the viewer is already playing: the closing frames and the
  // fall animation continue without a reload.
  Object.assign(r, final);
  replay = r;
  if (viewer) {
    viewer.live = false;
    viewer.playing = true;
  }
  $("#timeline").max = r.result.ticks / 60;
  $("#duration").textContent = clock(r.result.ticks / 60);
  renderEventMarks(r);
  track("play-finished", `${matchOutcome(r).title} ${botName(r.bots[1 - LIVE_PLAYER])}`);
  // The address bar becomes the challenge link as soon as the match is over.
  if (shareableChallenge(r))
    encodeChallenge(challengeFromReplay(r)).then((encoded) => {
      if (replay === r) updateUrl({ hash: challengeFragment(encoded) });
    });
}
// A manual duel against a registered controller, with its inputs logged.
function shareableChallenge(r) {
  if (r?.mode !== "manual" || !r.inputs || r.bots.length !== 2) return false;
  const opponent = r.bots[1 - r.bots.findIndex((bot) => bot.id === "human")];
  return builtins.some((b) => b.id === opponent?.id);
}
$("#copy-challenge").onclick = async () => {
  if (!shareableChallenge(replay)) return;
  const url = new URL(location.href);
  url.search = "";
  url.hash = challengeFragment(await encodeChallenge(challengeFromReplay(replay)));
  history.replaceState(null, "", url);
  track("challenge-copied");
  try {
    await navigator.clipboard.writeText(url.href);
    toast("Challenge link copied. Paste it anywhere.");
  } catch {
    toast("The challenge link is in the address bar: copy it from there.", true);
  }
};
$("#beat-challenge").onclick = () => {
  if (!challengeSettings) return;
  $("#seed").value = String(challengeSettings.seed);
  $("#spawn").value = challengeSettings.mirrored ? "mirror" : "normal";
  $("#bot-b").value = String(challengeSettings.bot);
  track("challenge-beat");
  startLiveMatch();
};
// A link with `#m=` rebuilds the match it describes before anything else.
async function openChallenge(text) {
  const failed = (message, reason) => {
    track("challenge-opened", reason);
    if (viewer) $("#stage-loading").hidden = true;
    toast(message, true);
  };
  let c;
  try {
    c = await decodeChallenge(text);
  } catch (error) {
    return failed(error.message + " You can simulate a new match.", "damaged");
  }
  const index = builtins.findIndex((b) => b.id === c.botId);
  const bot = builtins[index];
  if (!bot) return failed(`This challenge was played against "${c.botId}", a controller this arena does not have.`, "unknown bot");
  $("#seed").value = String(c.seed);
  $("#spawn").value = c.mirrored ? "mirror" : "normal";
  $("#bot-b").value = String(index);
  challengeSettings = { seed: c.seed, mirrored: c.mirrored, bot: index };
  const playable = ` You can still play the same seed against ${botName(bot)}: press "Play yourself vs Robot B".`;
  if (c.engineVersion !== ENGINE_VERSION)
    return failed(`This challenge was recorded with engine ${c.engineVersion}; this arena runs ${ENGINE_VERSION}, so the replay cannot be rebuilt.` + playable, "engine mismatch");
  if (digest(bot.source).slice(0, SHA_PREFIX) !== c.sha)
    return failed(`${botName(bot)} was updated after this match was played, so the replay cannot be rebuilt.` + playable, "controller updated");
  track("challenge-opened", "ok");
  interruptPlayback();
  if (viewer) viewer.playing = false;
  $("#stage-loading").hidden = false;
  $("#stage-loading b").textContent = "Rebuilding the challenge";
  $("#loading-detail").textContent = `Replaying the logged inputs against ${botName(bot)}…`;
  $("#simulation-progress").value = 0;
  $("#cancel").hidden = false;
  $("#result-banner").hidden = true;
  const inputs = [];
  inputs[c.player] = c.inputs;
  startOperation("resimulate", { bot, seed: c.seed, mirrored: c.mirrored, player: c.player, inputs });
}
function abortLiveMatch() {
  liveReplay = null;
  if (viewer) {
    viewer.live = false;
    viewer.playing = false;
  }
  if (previousReplay) return loadReplay(previousReplay);
  replay = null;
  $("#stage-loading").hidden = false;
  $("#stage-loading b").textContent = "Match abandoned";
  $("#loading-detail").textContent =
    "Simulate a match or start another manual duel.";
}
function sendLiveInput() {
  const held = (action) =>
    [...heldKeys].some((code) => CONTROL_KEYS[code] === action);
  worker?.postMessage({
    type: "input",
    thrust: (held("forward") ? 1 : 0) - (held("back") ? 1 : 0),
    turn: (held("left") ? 1 : 0) - (held("right") ? 1 : 0),
  });
}
$("#play-manual").onclick = startLiveMatch;
$("#live-stop").onclick = () => {
  if (!worker) return;
  worker.postMessage({ type: "cancel" });
  toast("Manual match left.");
};
document.addEventListener("keydown", (e) => {
  if (!liveActive || !CONTROL_KEYS[e.code]) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  e.preventDefault();
  if (e.repeat || heldKeys.has(e.code)) return;
  heldKeys.add(e.code);
  sendLiveInput();
});
document.addEventListener("keyup", (e) => {
  if (heldKeys.delete(e.code)) sendLiveInput();
});
// Touch buttons feed the same held set as the keys: a finger down is a key down.
for (const button of document.querySelectorAll("#touch-pad button")) {
  const code = "touch:" + button.dataset.control;
  const release = () => {
    button.classList.remove("held");
    if (heldKeys.delete(code)) sendLiveInput();
  };
  button.onpointerdown = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    button.classList.add("held");
    if (!heldKeys.has(code)) {
      heldKeys.add(code);
      sendLiveInput();
    }
  };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = release;
  button.oncontextmenu = (e) => e.preventDefault();
}
addEventListener("blur", () => {
  if (!heldKeys.size) return;
  heldKeys.clear();
  sendLiveInput();
});
function applyMatchSettings() {
  let settings = null;
  try {
    settings = readMatchSettings(location.search, bots);
  } catch (error) {
    toast(error.message + " Default settings are used.", true);
  }
  if (!settings) return;
  if (settings.a !== null) $("#bot-a").value = String(settings.a);
  if (settings.b !== null) $("#bot-b").value = String(settings.b);
  if (settings.seed !== null) $("#seed").value = String(settings.seed);
  if (settings.spawn !== null) $("#spawn").value = settings.spawn;
}
$("#export-replay").onclick = () => {
  if (replay)
    download(`llms-robot-arena-${replay.seed}.json`, stringifyReplay(replay));
};
$("#import-replay").onclick = () => $("#replay-file").click();
$("#replay-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024)
      throw Error("Replay is too large (20 MB maximum).");
    loadReplay(parseReplay(await file.text()));
    toast("Replay imported. Press play.");
  } catch (e) {
    toast(e.message, true);
  }
  e.target.value = "";
};
let editing = 0;
function lineNumbers() {
  const el = $("#code-editor");
  $("#line-numbers").textContent = Array.from(
    { length: el.value.split("\n").length },
    (_, i) => i + 1,
  ).join("\n");
}
function loadEditor(index) {
  editing = index;
  $("#code-editor").value = bots[index].source;
  $("#bot-name").value = botName(bots[index]);
  $("#bot-provider").value = bots[index].provider ?? "";
  $("#unsaved").hidden = true;
  $("#gate-results").innerHTML = "";
  lineNumbers();
}
$("#edit-bot").onchange = (e) => loadEditor(+e.target.value);
$("#code-editor").oninput = () => {
  lineNumbers();
  $("#unsaved").hidden = false;
};
$("#bot-name").oninput = $("#bot-provider").onchange = () => { $("#unsaved").hidden = false; };
$("#code-editor").onscroll = (e) =>
  ($("#line-numbers").scrollTop = e.target.scrollTop);
$("#code-editor").onkeydown = (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const el = e.target,
      start = el.selectionStart,
      end = el.selectionEnd;
    el.setRangeText("  ", start, end, "end");
    lineNumbers();
    $("#unsaved").hidden = false;
  }
};
function customId() {
  let number = bots.length - builtins.length + 1;
  while (bots.some(bot => bot.id === "custom-" + number)) number++;
  return "custom-" + number;
}
$("#new-bot").onclick = () => {
  const template = builtins.find(bot => bot.provenance === "reference");
  if (!template) return toast("No reference controller is registered.", true);
  bots.push({
    id: customId(),
    model: "Custom controller " + (bots.length - builtins.length + 1),
    provider: null,
    provenance: "iterative",
    source: template.source,
  });
  refreshBotOptions();
  $("#edit-bot").value = bots.length - 1;
  loadEditor(bots.length - 1);
  toast("Controller created from the reference controller.");
};
$("#save-bot").onclick = () => {
  let model = $("#bot-name").value.trim();
  if (!model) return toast("Enter a model name.", true);
  if (editing < builtins.length && model === botName(bots[editing])) model += " (custom)";
  if (bots.some((bot, i) => i !== editing && botName(bot) === model))
    return toast("This name is already in use.", true);
  const copy = {
    id: editing < builtins.length ? customId() : bots[editing].id,
    model,
    provider: $("#bot-provider").value || null,
    provenance: "iterative",
    source: $("#code-editor").value,
  };
  const index = editing < builtins.length ? bots.length : editing;
  bots[index] = copy;
  refreshBotOptions();
  $("#edit-bot").value = index;
  loadEditor(index);
  toast("Controller is ready in the match selectors. Download the file to keep a copy.");
};
$("#download-bot").onclick = () =>
  download(
    controllerFilename($("#bot-name").value),
    $("#code-editor").value,
    "text/plain",
  );
$("#run-gate").onclick = () => {
  $("#gate-results").innerHTML =
    '<p class="gate-running"><span class="loader"></span>Checking 200 snapshots and 600 ticks…</p>';
  startOperation("gate", { source: $("#code-editor").value });
};
function gateLabel(gate) {
  return gate.pass ? "Passed" : gate.eligible ? "Ready for exhibition" : "Check failed";
}
function gateMarkup(gate) {
  const eligible = gate.eligible ?? gate.pass;
  const status = gate.pass ? "pass" : eligible ? "advisory" : "fail";
  return `<div class="gate-verdict ${status}">${icon(eligible ? "check" : "close")} ${gateLabel(gate)}</div>${eligible && !gate.pass ? '<p class="gate-advisory">The 2 ms timing check failed on this device. This exhibition uses a deterministic instruction budget, so timing is advisory.</p>' : ""}${gate.checks.map(c => `<div class="gate-check ${c.pass ? "pass" : c.required === false ? "advisory" : "fail"}">${!c.pass && c.required === false ? '<span aria-hidden="true">!</span>' : icon(c.pass ? "check" : "close", 14)}<span>${esc(c.name)}${c.detail ? `<small>${esc(c.detail)}${c.required === false ? " · timing advisory" : ""}</small>` : ""}</span></div>`).join("")}`;
}
function renderGate(gate) {
  $("#gate-results").innerHTML = gateMarkup(gate);
}
function renderTournamentGate(bot, gate) {
  const result = document.createElement("details");
  result.className = "tournament-gate";
  result.open = !(gate.eligible ?? gate.pass);
  result.innerHTML = `<summary>${esc(botName(bot))} · ${gateLabel(gate)}</summary>${gateMarkup(gate)}`;
  $("#tournament-gates").appendChild(result);
  $("#tournament-gates").hidden = false;
}
loadEditor(0);
function updateTournamentFormat() {
  const count = document.querySelectorAll("#tournament-bots input:checked").length;
  if (count < 2) {
    $("#tournament-description").textContent = "Select at least two controllers.";
    return;
  }
  const schedule = exhibitionSchedule(count, $("#tournament-format").value);
  $("#tournament-description").textContent = schedule.format === "quick"
    ? `${schedule.rounds} rounds · different opponents · mirrored spawns · ${schedule.matches.length} matches${count % 2 ? " · rotating byes, no points" : ""}`
    : `10 seeds per pair · mirrored spawns · ${schedule.matches.length} matches`;
}
$("#tournament-format").onchange = updateTournamentFormat;
$("#tournament-bots").onchange = updateTournamentFormat;
$("#run-tournament").onclick = () => {
  const selected = [
    ...document.querySelectorAll("#tournament-bots input:checked"),
  ].map((i) => bots[+i.value]);
  if (selected.length < 2)
    return toast("Select at least two controllers.", true);
  report = null;
  tournamentReplays.clear();
  $("#tournament-gates").innerHTML = "";
  $("#tournament-gates").hidden = true;
  $("#export-ranking").disabled = true;
  $("#export-report").disabled = true;
  $("#ranking-surface").innerHTML = '<div class="empty-ranking"><h2>Checking controllers…</h2><p>The provisional ranking updates after every completed match.</p></div>';
  $("#tournament-style").innerHTML = "";
  $("#tournament-code").innerHTML = "";
  $("#tournament-index").innerHTML = "";
  $("#tournament-matches").innerHTML = "";
  $("#cancel-tournament").hidden = false;
  $("#tournament-progress").hidden = false;
  $("#tournament-progress progress").value = 0;
  $("#tournament-status").textContent = "Running controller conformance gates…";
  startOperation("tournament", { bots: selected, format: $("#tournament-format").value });
};
function renderRanking() {
  const rows = report.ranking;
  $("#export-ranking").disabled = false;
  $("#export-report").disabled = false;
  const heading = report.published
    ? "Published standings"
    : report.status === "complete" ? "Final ranking" : "Provisional ranking";
  const format = report.format === "quick" ? "QUICK ROUNDS" : "ROUND ROBIN";
  const tag = report.published
    ? `PUBLISHED · ${report.records.length} MATCHES · ${format}${report.generatedAt ? " · " + esc(report.generatedAt.slice(0, 10)) : ""}`
    : `${report.records.length} / ${report.totalMatches} MATCHES · ${format} · ${esc(report.status.toUpperCase())}`;
  $("#ranking-surface").innerHTML =
    `<div class="ranking-header"><h2>${heading}</h2><span class="tag">${tag}</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Controller</th><th>Bradley–Terry</th><th>95% CI</th><th>Score %</th><th>W / D / L</th><th>Δ Flip</th><th>Ring-out + / −</th><th>Mean energy</th><th>First contact</th><th>Violations / match</th><th>Timeouts</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="rank-number">${String(i + 1).padStart(2, "0")}</td><td><strong>${esc(botName(r))}</strong><small>${esc(botDetails(r))}</small></td><td class="bt-score">${r.score.toFixed(1)}</td><td class="mono">${r.ci?.map((n) => n.toFixed(1)).join(" – ") ?? "—"}</td><td>${(r.winRate * 100).toFixed(1)}%</td><td class="mono">${r.wins} / ${r.draws} / ${r.matches - r.wins - r.draws}</td><td>${r.flipDifferential > 0 ? "+" : ""}${r.flipDifferential}</td><td>${r.ringOutsInflicted} / ${r.ringOutsTaken}</td><td>${r.meanEnergy.toFixed(1)}</td><td>${r.meanFirstContactTick === null ? "—" : (r.meanFirstContactTick / 60).toFixed(1) + " s"}</td><td>${r.violationsPerMatch.toFixed(2)}</td><td>${r.timeouts}</td></tr>`).join("")}</tbody></table></div>`;
  renderStyle();
  renderCode();
  renderIndex();
}
// One radar per controller: the axes are scaled against the rest of the roster,
// so the shape compares controllers instead of measuring them absolutely.
function radarShape(profile) {
  const point = (index, radius) => {
    const angle = (Math.PI * 2 * index) / STYLE_AXES.length - Math.PI / 2;
    return [60 + radius * Math.cos(angle), 60 + radius * Math.sin(angle)];
  };
  const ring = radius =>
    STYLE_AXES.map((_, i) => point(i, radius).map(n => n.toFixed(1)).join(",")).join(" ");
  const shape = STYLE_AXES
    .map((axis, i) => point(i, 12 + 34 * Math.min(1, Math.max(0, profile[axis.key]))).map(n => n.toFixed(1)).join(","))
    .join(" ");
  const spokes = STYLE_AXES.map((_, i) => {
    const [x, y] = point(i, 46);
    return `<line class="radar-grid" x1="60" y1="60" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join("");
  const labels = STYLE_AXES.map((axis, i) => {
    const [x, y] = point(i, 54);
    // Left of the centre the text runs outwards to the left, right of it to the right.
    const anchor = x > 61 ? "start" : x < 59 ? "end" : "middle";
    const dx = anchor === "start" ? 4 : anchor === "end" ? -4 : 0;
    const dy = y > 61 ? 8 : y < 59 ? 0 : 3;
    return `<text class="radar-label" x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}">${esc(axis.short ?? axis.label)}</text>`;
  }).join("");
  return `<svg viewBox="-40 -8 200 142" role="img" aria-hidden="true"><polygon class="radar-grid" points="${ring(46)}"/><polygon class="radar-grid" points="${ring(23)}"/>${spokes}<polygon class="radar-shape" points="${shape}"/>${labels}</svg>`;
}
function renderStyle() {
  const profiles = styleProfiles(report.ranking);
  $("#tournament-style").innerHTML = profiles
    ? `<div class="ranking-header"><h2>Play style</h2><span class="tag">MEASURED OVER THE SAME MATCHES · SCALED ON THIS ROSTER</span></div><div class="style-cards">${report.ranking.map((r, i) => `<article class="style-card"><header><strong>${esc(botName(r))}</strong><span class="tag">${esc(styleLabel(profiles[i]))}</span></header>${radarShape(profiles[i])}<dl>${STYLE_AXES.map(axis => `<div><dt>${esc(axis.label)}</dt><dd>${esc(formatStyleValue(axis, r.style))}</dd></div>`).join("")}</dl></article>`).join("")}</div>`
    : "";
}
// Results and source folded into one number. The ranking stays the ranking.
function renderIndex() {
  const rows = compositeIndex(report);
  $("#tournament-index").innerHTML = rows
    ? `<div class="ranking-header"><h2>Craft index</h2><span class="tag">RESULTS AND SOURCE · NOT THE RANKING</span></div><div class="table-scroll"><table><thead><tr><th>Controller</th><th>Craft index</th>${INDEX_TERMS.map(term => `<th>${esc(term.label)} · ${Math.round(term.weight * 100)}%</th>`).join("")}</tr></thead><tbody>${report.ranking.map((row, i) => `<tr><td><strong>${esc(botName(row))}</strong></td><td class="bt-score">${rows[i].index.toFixed(1)}</td>${INDEX_TERMS.map(term => `<td class="mono">${rows[i].terms[term.key] === null ? "—" : rows[i].terms[term.key].toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : "";
}
// Static source measurements, published with the standings.
function renderCode() {
  const order = new Map(report.ranking.map((row, i) => [row.id, i]));
  const rows = (report.bots ?? [])
    .filter(bot => bot.code)
    .sort((x, y) => (order.get(x.id) ?? Infinity) - (order.get(y.id) ?? Infinity));
  $("#tournament-code").innerHTML = rows.length
    ? `<div class="ranking-header"><h2>Implementation</h2><span class="tag">MEASURED FROM THE SUBMITTED SOURCE</span></div><div class="table-scroll"><table><thead><tr><th>Controller</th><th>Language</th><th>Lines</th><th>Code</th><th>Comments</th><th>Functions</th><th>Cyclomatic</th><th>Max nesting</th><th>Size</th></tr></thead><tbody>${rows.map(bot => `<tr><td><strong>${esc(botName(bot))}</strong></td><td>${esc(bot.code.language)}</td><td class="mono">${bot.code.lines}</td><td class="mono">${bot.code.codeLines}</td><td class="mono">${bot.code.commentLines}</td><td class="mono">${bot.code.functions}</td><td class="mono">${bot.code.complexity}</td><td class="mono">${bot.code.maxDepth}</td><td class="mono">${(bot.code.bytes / 1024).toFixed(1)} kB</td></tr>`).join("")}</tbody></table></div>`
    : "";
}
function renderTournamentMatches() {
  $("#tournament-matches").innerHTML = report.records.length
    ? `<div class="ranking-header"><h2>Completed matches</h2><span class="tag">WATCH WHILE THE TOURNAMENT RUNS</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Round</th><th>Match</th><th>Seed / spawn</th><th>Result</th><th>Replay</th></tr></thead><tbody>${report.records.map((r, i) => `<tr><td>${i + 1}</td><td>${r.round}</td><td>${esc(botName(report.bots[r.a]))} vs ${esc(botName(report.bots[r.b]))}</td><td>${r.seed} / ${r.mirrored ? "Mirrored" : "Standard"}</td><td>${r.score === 0.5 ? "Draw" : esc(botName(report.bots[r.score === 1 ? r.a : r.b])) + " wins"}<small>${esc(r.reason)} · ${clock(r.ticks / 60)}</small></td><td><button class="button outline" data-watch-match="${i}">${icon("play")}Watch</button></td></tr>`).reverse().join("")}</tbody></table></div>`
    : "";
}
$("#tournament-matches").onclick = event => {
  const button = event.target.closest("[data-watch-match]");
  if (!button) return;
  const completed = tournamentReplays.get(Number(button.dataset.watchMatch));
  if (completed) {
    loadReplay(completed, true);
    $('[data-tab="arena"]').click();
  }
};
$("#export-report").onclick = () => {
  if (report) download("RESULTS.md", renderReport(report), "text/markdown");
};
$("#export-ranking").onclick = () => {
  if (report)
    download("llms-robot-arena-tournament.json", JSON.stringify(report, null, 2));
};
function stepFrame(direction, count = 1) {
  if (!viewer || !replay || operation === "match") return;
  cancelIntro();
  viewer.playing = false;
  viewer.seek(
    (Math.round(Math.min(viewer.time, viewer.duration) * 60) +
      direction * count) /
      60,
  );
}
$("#step-back").onclick = () => stepFrame(-1);
$("#step-forward").onclick = () => stepFrame(1);
document.addEventListener("keydown", (e) => {
  if (
    /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName) ||
    $("#panel-arena").hidden ||
    operation === "match" ||
    liveActive
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    cancelIntro();
    viewer?.toggle();
  }
  if (e.code === "Home") {
    e.preventDefault();
    cancelIntro();
    if (viewer) viewer.playing = false;
    viewer?.seek(0);
  }
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    stepFrame(e.code === "ArrowLeft" ? -1 : 1, e.shiftKey ? 60 : 1);
  }
});
async function loadReplayUrl(path) {
  const url = siteUrl(path);
  if (url.origin !== location.origin)
    throw Error("The replay must be hosted on the same server.");
  const response = await fetch(url);
  if (!response.ok) throw Error("Replay unavailable.");
  loadReplay(parseReplay(await response.text()));
}
$("#replay-library").onchange = async (e) => {
  if (!e.target.value) return;
  const path = "./replays/" + encodeURIComponent(e.target.value);
  try {
    await loadReplayUrl(path);
    updateUrl({ search: "?" + new URLSearchParams({ replay: path }) });
  } catch (error) {
    toast(error.message, true);
  }
};
// Standings published with the repository; starting a tournament replaces them.
fetch(siteUrl("standings.json"))
  .then((r) => (r.ok ? r.json() : null))
  .then((published) => {
    if (report || !published?.ranking?.length) return;
    // Published records have no replays to watch, so only the ranking is shown.
    report = { ...published, published: true };
    renderRanking();
  })
  .catch(() => {});
fetch(siteUrl("replays.json"))
  .then((r) => (r.ok ? r.json() : []))
  .then((names) => {
    if (!Array.isArray(names) || !names.length) return;
    for (const name of names) {
      if (typeof name !== "string") continue;
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      $("#replay-library").appendChild(option);
    }
    $("#replay-library").hidden = false;
  })
  .catch(() => {});
const requestedReplay = new URLSearchParams(location.search).get("replay");
const requestedChallenge = readChallenge(location.hash);
let armed = false;
// The opening match waits for the arena: a visitor who followed a link to the
// rules should not pay for a simulation they are not looking at.
function armArena() {
  // A tournament replay opened from its own panel is already on the stage: the
  // opening match must not overwrite what the visitor asked to watch.
  if (armed || replay) return;
  armed = true;
  if (requestedChallenge) {
    openChallenge(requestedChallenge);
  } else if (requestedReplay) {
    loadReplayUrl(requestedReplay).catch((e) => {
      if (viewer) $("#stage-loading").hidden = true;
      toast(e.message + " You can simulate a new match.", true);
    });
  } else {
    applyMatchSettings();
    $("#simulate").click();
  }
}
if (initialTab.id === "arena") armArena();
