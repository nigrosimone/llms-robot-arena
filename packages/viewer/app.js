import { SPEC as S, SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";
import { renderReport } from "../tournament/report.js";
import { ArenaViewer } from "./arena.js";
import { stringifyReplay, parseReplay } from "../sim/replay.js";
import builtins from "arena:bots";
import { botName, botDetails } from "../bot-catalog.js";
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
let replay = null,
  viewer = null,
  worker = null,
  operation = null,
  report = null,
  lastFrame = null;
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
document.querySelector("#app").innerHTML = `
<header class="header">
 <a class="brand" href="./" aria-label="llms-robot-arena, home"><span class="brand-mark" aria-hidden="true">R<span>↗</span></span><span>llms-<span class="brand-second">robot-arena</span></span></a>
 <nav aria-label="Main navigation">${[
   ["arena", "Arena", "arena"],
   ["lab", "Bot Lab", "code"],
   ["tournament", "Tournament", "trophy"],
   ["rules", "Rules", "book"],
 ]
   .map(
     ([id, label, ic]) =>
       `<button class="nav-button ${id === "arena" ? "selected" : ""}" data-tab="${id}" aria-current="${id === "arena" ? "page" : "false"}">${icon(ic)}<span>${label}</span></button>`,
   )
   .join("")}</nav>
 <div class="header-end"><span class="version">SPEC ${SPEC_VERSION.replace("-draft", "")} </span></div>
</header>
<main>
 <section id="panel-arena" class="panel">
  <div class="page-heading"><div><div class="eyebrow">AUTONOMOUS COMBAT LAB <span>/ 01</span></div><h1>The arena decides<span>.</span></h1></div><div class="heading-actions"><select id="replay-library" aria-label="Local tournament replays" hidden><option value="">Tournament replays…</option></select><button id="import-replay" class="button quiet">${icon("upload")}Import replay</button><button id="export-replay" class="button outline" disabled>${icon("download")}Export replay</button><input type="file" id="replay-file" accept=".json,application/json" hidden></div></div>
  <div class="arena-layout">
   <div class="match-surface">
    <div class="stage" id="stage">
     <div class="stage-header"><div class="record-tag"><span class="record-dot"></span>REPLAY <span id="replay-seed">SEED 00</span></div><div class="stage-clock"><b id="match-clock">00:00</b><span>/ 02:00</span></div><span class="arena-size" id="arena-size">16.0 × 16.0 M</span></div>
     <div id="viewport"></div>
     <div class="stage-note"><span id="pressure-tag">RAISED PLATFORM</span><span id="camera-hint">Auto camera · follows both robots</span><span id="collapse-warning" role="status" aria-live="polite" hidden></span></div>
     <div class="camera-actions"><label class="camera-toggle"><input id="manual-camera" type="checkbox" aria-describedby="camera-hint">Manual camera</label><button id="reset-camera" class="icon-button" aria-label="Reset camera" title="Reset camera">${icon("reset")}</button><button id="fullscreen" class="icon-button" aria-label="Fullscreen" title="Fullscreen">${icon("expand")}</button></div>
     <div id="stage-loading" class="stage-loading"><span class="loader"></span><b>Preparing replay</b><span id="loading-detail">Simulation comes before every frame.</span><progress id="simulation-progress" value="0" max="1"></progress><button id="cancel" class="button outline" hidden>Cancel</button></div>
     <div id="result-banner" class="result-banner" hidden><span id="result-label" class="eyebrow">MATCH COMPLETE</span><strong id="result-title"></strong><span id="result-reason"></span><button id="watch-again" class="button accent">${icon("reset")}Watch again</button></div>
    </div>
    <div class="playback"><button id="step-back" class="icon-button" aria-label="Previous frame" title="Previous frame (←)">‹</button><button id="play" class="play-button" aria-label="Play" disabled>${icon("play", 20)}</button><button id="step-forward" class="icon-button" aria-label="Next frame" title="Next frame (→)">›</button><span id="elapsed" class="mono">00:00</span><div class="scrubber"><div id="event-marks"></div><input type="range" id="timeline" aria-label="Replay position" min="0" max="120" step="any" value="0" disabled></div><span id="duration" class="mono secondary">02:00</span><select id="speed" aria-label="Playback speed"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></div>
    <div class="terrain-legend" aria-label="Arena cells"><span><i class="legend-recharge"></i>Recharge +60</span><span><i class="legend-hole"></i>Hole: instant loss</span><span><i class="legend-flame"></i>Grate: warning then flame</span><span><i class="legend-wear"></i>Cracks: weight damage</span><span><i class="legend-collapse"></i>Red flash: floor collapse</span></div>
    <div class="robot-stats">${[0, 1].map((i) => `<article class="robot-card robot-${i}"><div class="robot-ident"><span class="robot-avatar">${icon("arena", 26)}</span><div><span class="eyebrow">ROBOT ${i ? "B" : "A"}</span><h2 id="robot-name-${i}">${esc(botName(builtins[i]))}</h2><span class="bot-provider" id="robot-provider-${i}">${esc(botDetails(builtins[i]))}</span></div><span id="robot-status-${i}" class="status-tag">ACTIVE</span></div><div class="energy-row"><span>${icon("bolt", 14)}Energy</span><strong><span id="energy-${i}">${S.ENERGY_MAX}</span><small> / <span id="energy-max-${i}">${S.ENERGY_MAX}</span></small></strong></div><div class="energy-track"><span id="energy-bar-${i}" style="width:100%"></span></div><div class="robot-bottom"><span>Flips taken</span><div class="flip-pips" id="flips-${i}"><i></i><i></i><b>0 / 2</b></div></div></article>`).join("")}</div>
   </div>
   <aside class="match-sidebar">
    <div class="side-head"><h2>Set up match</h2>${icon("settings")}</div>
    <div class="side-body"><label class="field-label" for="bot-a"><span class="color-square a"></span>ROBOT A</label><select id="bot-a" class="bot-select"></select><label class="field-label" for="bot-b"><span class="color-square b"></span>ROBOT B</label><select id="bot-b" class="bot-select"></select>
     <div class="seed-row"><div><label for="seed" class="field-label">SEED</label><input id="seed" type="number" min="0" max="4294967295" step="1" value="0"></div><div><label for="spawn" class="field-label">SPAWN</label><select id="spawn"><option value="normal">Standard</option><option value="mirror">Mirrored</option></select></div></div>
     <button id="simulate" class="button accent run-button">${icon("play")}Simulate match${icon("arrow")}</button><p class="field-note">The entire match is computed before playback.</p>
    </div>
    <div class="mode-box"><span class="eyebrow">CURRENT MODE</span><div><span class="mode-symbol">E</span><strong id="current-mode">Local exhibition</strong></div><p id="mode-note">Exhibitions use a deterministic budget. Controller provenance is recorded in each replay.</p></div>
    <div class="event-section"><div class="side-head"><h2>Event log</h2><span class="count" id="event-count">0</span></div><div id="event-log" class="event-log"><p class="empty-note">Events will appear during playback.</p></div></div>
    
   </aside>
  </div>
  <div class="arena-footer"><span><i></i>60 HZ PHYSICS</span><span>100 KG / ROBOT</span><span>NO MANUAL CONTROL</span><span id="hash-label">SHA-256 · HASH EVERY 60 TICKS</span></div>
 </section>
 <section id="panel-lab" class="panel" hidden>
  <div class="page-heading"><div><div class="eyebrow">CONTROLLER WORKSPACE <span>/ 02</span></div><h1>Your code. Your robot<span>.</span></h1></div><button id="new-bot" class="button accent">${icon("plus")}New controller</button></div>
  <div class="lab-layout"><div class="editor-panel"><div class="editor-toolbar"><select id="edit-bot" aria-label="Controller to edit"></select><span class="mono secondary">JAVASCRIPT / TYPESCRIPT</span></div><div class="editor-file">${icon("code", 16)}<span>controller.ts</span><span id="unsaved" class="unsaved" hidden>Unsaved changes</span></div><div class="editor-body"><pre id="line-numbers" aria-hidden="true"></pre><textarea id="code-editor" aria-label="Controller source" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div><div class="editor-footer"><input id="bot-name" aria-label="Model name" placeholder="Model name" maxlength="80"><select id="bot-provider" aria-label="Model provider"><option value="">No provider</option><option>OpenAI</option><option>Anthropic</option></select><button id="download-bot" class="button outline">${icon("download")}.ts file</button><button id="save-bot" class="button accent">Save controller</button></div></div>
   <aside class="lab-sidebar"><div class="info-card"><div class="eyebrow">THE CONTRACT</div><h2>One function. Two commands.</h2><code>tick(sensors, memory)</code><p>Return <code>actions</code> and <code>memory</code>. All data uses world coordinates.</p><dl><dt>thrust</dt><dd>−1 reverse → +1 forward</dd><dt>turn</dt><dd>−1 clockwise → +1 counterclockwise</dd><dt>memory</dt><dd>JSON · up to 64 KB</dd></dl></div><div class="info-card gate-card"><div class="eyebrow">CONFORMANCE GATE</div><h2>Validate the contract.</h2><p>200 snapshots and 600 inert ticks. These checks offer no combat advice.</p><button id="run-gate" class="button outline full-width">${icon("check")}Check controller</button><div id="gate-results" aria-live="polite"></div></div><p class="side-hint">Edits here are iterative experimentation. For a one-shot benchmark, follow AGENTS.md and use the project CLI.</p></aside>
  </div>
 </section>
 <section id="panel-tournament" class="panel" hidden>
  <div class="page-heading"><div><div class="eyebrow">ROUND ROBIN <span>/ 03</span></div><h1>Earn your ranking<span>.</span></h1></div><div class="heading-actions"><button id="export-report" class="button quiet" disabled>${icon("download")}.md report</button><button id="export-ranking" class="button outline" disabled>${icon("download")}Export results</button></div></div>
  <div class="tournament-setup"><div><span class="eyebrow">EXHIBITION TOURNAMENT</span><h2>Every bot. Every opponent.</h2><p>20 matches per pair · 10 seeds · swapped spawns · 1,000 bootstrap samples</p><div id="tournament-bots" class="bot-checks"></div></div><button id="run-tournament" class="button accent">${icon("trophy")}Start tournament</button></div>
  <div id="tournament-progress" class="tournament-progress" hidden><div><strong id="tournament-status">Checking controllers…</strong><button id="cancel-tournament" class="button quiet">Cancel</button></div><progress max="1" value="0"></progress></div>
  <div id="ranking-surface" class="ranking-surface"><div class="empty-ranking"><span>${icon("trophy", 44)}</span><h2>No verdict yet.</h2><p>Select at least two controllers and start the tournament.<br>Rankings appear once the matches have actually been played.</p></div></div>
  <p class="tournament-note">Regularized Bradley–Terry: mean strength = 100. The 95% CI resamples seeds, keeping mirrored spawns together. Browser results are exhibitions; the one-shot protocol with a 2 ms budget is available through the CLI.</p>
 </section>
 <section id="panel-rules" class="panel" hidden>
  <div class="page-heading"><div><div class="eyebrow">SPEC ${SPEC_VERSION.replace("-draft", "")} <span>/ 04</span></div><h1>Same hardware. Different minds<span>.</span></h1></div></div>
  <div class="rules-grid"><article class="info-card"><span class="rule-number">01 / ARENA</span><h2>The edge is unforgiving.</h2><p>A 16 × 16 meter platform with no walls. A robot is out when its center crosses the edge. From 60 seconds onward, the half-side shrinks by 0.07 m/s.</p><div class="rule-value">16 <span>→</span> 7.6 <small>meters at 120 s</small></div></article><article class="info-card"><span class="rule-number">02 / WEDGE</span><h2>Where you hit matters.</h2><p>The wedge covers ±35° in front of the robot. A strong side or rear impact can flip an opponent; wedge-to-wedge contact never causes a flip. Taking two flips ends the match.</p><div class="rule-value">±35° <small>front sector</small></div></article><article class="info-card"><span class="rule-number">03 / ENERGY</span><h2>Every command has a cost.</h2><p>Motor cost is quadratic. There is no passive regeneration. Enter a ready blue cell to collect up to ${S.RECHARGE_AMOUNT} energy. Each cell needs ${S.RECHARGE_COOLDOWN} seconds to reset; leave and return to collect again. At zero, the motors stop.</p><div class="rule-value">${S.ENERGY_MAX} <small>starting energy</small></div></article><article class="info-card"><span class="rule-number">04 / VICTORY</span><h2>A clear order.</h2><ol><li>Fall off the edge or into a hole</li><li>Two flips</li><li>Disqualification at 20 violations</li><li>At 120 s: fewer flips taken, then more energy, then closer to the center</li></ol><p>Only exact ties and simultaneous defeats remain draws.</p></article><article class="info-card"><span class="rule-number">05 / PHYSICS</span><h2>The simulation is authoritative.</h2><p>Fixed 60 Hz steps, semi-implicit Euler integration, oriented rectangles and SAT collisions. The viewer reads a completed replay: pausing, moving the camera and changing playback speed do not affect the result.</p></article><article class="info-card"><span class="rule-number">06 / BENCHMARK</span><h2>Conformance before competition.</h2><p>One JS or TS file, one tick export, no imports or external APIs. QuickJS runs in a Worker sandbox. Public tests check execution, purity, memory and timing.</p></article></div>
  <div class="rules-grid hazard-rules"><article class="info-card"><span class="rule-number">07 / TERRAIN</span><h2>Know the floor.</h2><p>Every seed places four blue recharge cells, two or three open holes and four flame grates. Cells stay in fixed world positions as the boundary shrinks. Their states are visible in the bot sensors. During the match, four ordinary floor cells can also collapse. Each flashes red for three seconds before becoming a permanent hole. Robot weight also wears down every solid cell, including chargers and grates: 12 cumulative seconds under one bot exhausts it, then a three-second warning precedes collapse. Wear persists after leaving; two bots double the load.</p></article><article class="info-card"><span class="rule-number">08 / FIRE</span><h2>Read the warning.</h2><p>Grates wait 4-8 seconds, warn in amber for one second, then burn for 1.5 seconds. Standing over a flame costs ${S.FLAME_DAMAGE} energy per second, including while flipped or recovering.</p></article></div>
  <div class="review-note"><strong>Simulation and runtime rules.</strong><p>The recovering state accepts commands and protects against flips. The 3 m limit is not reached within 120 seconds. Wall-clock timing depends on machine load, so exhibitions use a reproducible instruction limit; the CLI also supports the 2 ms budget. Results for these budgets are kept separate.</p></div>
 </section>
</main><footer class="footer"><span><a href="https://github.com/nigrosimone/llms-robot-arena" title="View llms-robot-arena on GitHub">llms-robot-arena</a></span><span>Code makes the difference.</span><span>ENGINE ${ENGINE_VERSION}</span></footer><div id="toast" role="status" aria-live="polite" hidden></div>`;
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
    el.innerHTML = bots
      .map((b, i) => `<option value="${i}">${esc(botName(b))} / ${esc(botDetails(b))}</option>`)
      .join("");
    el.value = value || "0";
  }
  $("#tournament-bots").innerHTML = bots
    .map(
      (b, i) =>
        `<label class="bot-checkbox"><input type="checkbox" value="${i}" ${i < 2 ? "checked" : ""}><span>${esc(botName(b))}<small class="bot-provider">${esc(botDetails(b))}</small></span></label>`,
    )
    .join("");
}
refreshBotOptions();
$("#bot-b").value = "1";
document.querySelectorAll("[data-tab]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document
      .querySelectorAll(".panel")
      .forEach((p) => (p.hidden = p.id !== "panel-" + tab));
    document.querySelectorAll("[data-tab]").forEach((b) => {
      b.classList.toggle("selected", b === btn);
      b.setAttribute("aria-current", b === btn ? "page" : "false");
    });
  }),
);
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
    $("#robot-status-" + i).textContent = r.hole ? "FELL THROUGH" : r.ringOut ? "RING-OUT" : ["ACTIVE", "FLIPPED", "RECOVERING"][r.status];
    $("#robot-status-" + i).classList.toggle("danger", r.status === 1 || r.ringOut);
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
    $("#result-title").textContent =
      replay.result.winner === null
        ? "Draw."
        : botName(replay.bots[replay.result.winner]) + " wins.";
    $("#result-reason").textContent =
      {
        ["ring-out"]: "Ring-out",
        hole: "Fell through a hole",
        flips: "Two flips",
        disqualification: "Disqualification",
        timeout: replay.result.decision === "center" ? "Timeout ? closest to center" : "Timeout decision",
      }[replay.result.reason] +
      " · " +
      clock(viewer.duration);
  }
  const lastHash = replay?.stateHashes
    .filter((h) => h.tick <= time * 60)
    .at(-1);
  $("#hash-label").textContent = lastHash
    ? "SHA-256 " + lastHash.hash.slice(0, 12) + "…"
    : "SHA-256 · HASH EVERY 60 TICKS";
}
function loadReplay(r, autoplay = false) {
  delete $("#event-log").dataset.signature;
  replay = r;
  if (viewer) $("#stage-loading").hidden = true;
  $("#result-banner").hidden = true;
  $("#play").disabled = false;
  $("#timeline").disabled = false;
  $("#export-replay").disabled = false;
  $("#timeline").max = r.result.ticks / 60;
  $("#duration").textContent = clock(r.result.ticks / 60);
  $("#replay-seed").textContent =
    `SEED ${String(r.seed).padStart(2, "0")} ${r.mirrored ? "· M" : ""}`;
  r.bots.forEach((b, i) => {
    $("#robot-name-" + i).textContent = botName(b);
    $("#robot-provider-" + i).textContent = botDetails(b);
  });
  $("#current-mode").textContent =
    r.mode === "one-shot"
      ? "One-shot benchmark"
      : r.mode === "iterative"
        ? "Iterative benchmark"
        : "Local exhibition";
  $("#mode-note").textContent =
    `${r.runtime?.budgetMode === "wall" ? "2 ms wall-clock budget." : "Deterministic instruction budget."} ${r.mode === "exhibition" ? "Exhibition of the selected controllers. Provenance is recorded in exported metadata." : "See exported metadata for provenance."}`;
  $("#event-marks").innerHTML = r.events
    .filter((e) => ["flip", "ring-out", "hole", "recharge", "collapse-warning", "collapse"].includes(e.type))
    .map(
      (e) =>
        `<span class="mark-${e.type}" style="left:${((e.tick + 1) / r.result.ticks) * 100}%" title="${e.type}"></span>`,
    )
    .join("");
  viewer?.load(r);
  if (viewer) viewer.playing = autoplay;
  else {
    $("#stage-loading b").textContent =
      "Replay ready. 3D graphics unavailable.";
    $("#loading-detail").textContent =
      "Export the replay or open it in a browser with WebGL 2.";
    $("#play").disabled = true;
    $("#timeline").disabled = true;
  }
}
try {
  viewer = new ArenaViewer($("#viewport"), renderFrame);
} catch (e) {
  $("#stage-loading b").textContent = "WebGL 2 is unavailable.";
  $("#loading-detail").textContent =
    "You can create controllers, simulate matches and export replays. To use the viewer, open a browser with hardware acceleration.";
  $("#simulation-progress").hidden = true;
  $("#stage-loading .loader").hidden = true;
  toast("Could not start 3D graphics.", true);
}
$("#play").onclick = () => viewer?.toggle();
$("#watch-again").onclick = () => {
  viewer?.seek(0);
  if (viewer) viewer.playing = true;
};
$("#timeline").oninput = (e) => viewer?.seek(+e.target.value);
$("#speed").onchange = (e) => {
  if (viewer) viewer.speed = +e.target.value;
};
$("#reset-camera").onclick = () => viewer?.resetCamera();
$("#manual-camera").disabled = !viewer;
$("#manual-camera").onchange = (e) => {
  viewer?.setManualCamera(e.target.checked);
  $("#camera-hint").textContent = e.target.checked
    ? "Drag to orbit · right-drag to pan · scroll or pinch to zoom"
    : "Auto camera · follows both robots";
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
    .querySelectorAll("#simulate,#run-gate,#run-tournament")
    .forEach((b) => (b.disabled = busy));
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
      if (operation === "match") {
        $("#simulation-progress").value = data.progress;
        $("#loading-detail").textContent =
          `Simulation ${Math.round(data.progress * 100)}% · ${clock(data.progress * 120)} / 02:00`;
      } else if (operation === "tournament") {
        $("#tournament-progress progress").value = data.progress;
        $("#tournament-status").textContent =
          `${data.completed} / ${data.total} matches completed`;
      }
      return;
    }
    if (data.type === "error") {
      toast(data.message, true);
      if (operation === "gate")
        $("#gate-results").innerHTML =
          `<p class="gate-fail">${esc(data.message)}</p>`;
    }
    if (data.type === "replay") {
      loadReplay(data.replay, true);
      toast("Match computed. The replay is ready.");
    }
    if (data.type === "gate") {
      renderGate(data.gate);
    }
    if (data.type === "tournament") {
      report = data.report;
      renderRanking();
      toast("Tournament complete.");
    }
    finishOperation();
  };
  worker.onerror = (e) => {
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
  $("#tournament-progress").hidden = true;
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
$("#simulate").onclick = () => {
  const value = Number($("#seed").value);
  if (!Number.isInteger(value) || value < 0 || value > 4294967295)
    return toast("Enter an integer seed between 0 and 4294967295.", true);
  if (viewer) viewer.playing = false;
  $("#stage-loading").hidden = false;
  $("#stage-loading b").textContent = "Computing match";
  $("#loading-detail").textContent = "Starting the two isolated controllers…";
  $("#simulation-progress").value = 0;
  $("#cancel").hidden = false;
  $("#result-banner").hidden = true;
  startOperation("match", {
    bots: [bots[+$("#bot-a").value], bots[+$("#bot-b").value]],
    seed: value,
    mirrored: $("#spawn").value === "mirror",
  });
};
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
    ($("#bot-name")
      .value.trim()
      .replace(/[^a-zA-Z0-9_-]/g, "-") || "controller") + ".ts",
    $("#code-editor").value,
    "text/plain",
  );
$("#run-gate").onclick = () => {
  $("#gate-results").innerHTML =
    '<p class="gate-running"><span class="loader"></span>Checking 200 snapshots and 600 ticks…</p>';
  startOperation("gate", { source: $("#code-editor").value });
};
function renderGate(gate) {
  $("#gate-results").innerHTML =
    `<div class="gate-verdict ${gate.pass ? "pass" : "fail"}">${icon(gate.pass ? "check" : "close")} ${gate.pass ? "Passed" : "Check failed"}</div>${gate.checks.map((c) => `<div class="gate-check ${c.pass ? "pass" : "fail"}">${icon(c.pass ? "check" : "close", 14)}<span>${esc(c.name)}${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</span></div>`).join("")}`;
}
loadEditor(0);
$("#run-tournament").onclick = () => {
  const selected = [
    ...document.querySelectorAll("#tournament-bots input:checked"),
  ].map((i) => bots[+i.value]);
  if (selected.length < 2)
    return toast("Select at least two controllers.", true);
  $("#tournament-progress").hidden = false;
  $("#tournament-progress progress").value = 0;
  $("#tournament-status").textContent = "Running controller conformance gates…";
  startOperation("tournament", { bots: selected });
};
function renderRanking() {
  const rows = report.ranking;
  $("#export-ranking").disabled = false;
  $("#export-report").disabled = false;
  $("#ranking-surface").innerHTML =
    `<div class="ranking-header"><h2>Real results, uncertainty included.</h2><span class="tag">${report.records.length} MATCHES · EXHIBITION</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Controller</th><th>Bradley–Terry</th><th>95% CI</th><th>Score %</th><th>W / D / L</th><th>Δ Flip</th><th>Ring-out + / −</th><th>Mean energy</th><th>First contact</th><th>Violations / match</th><th>Timeouts</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="rank-number">${String(i + 1).padStart(2, "0")}</td><td><strong>${esc(botName(r))}</strong><small>${esc(botDetails(r))}</small></td><td class="bt-score">${r.score.toFixed(1)}</td><td class="mono">${r.ci.map((n) => n.toFixed(1)).join(" – ")}</td><td>${(r.winRate * 100).toFixed(1)}%</td><td class="mono">${r.wins} / ${r.draws} / ${r.matches - r.wins - r.draws}</td><td>${r.flipDifferential > 0 ? "+" : ""}${r.flipDifferential}</td><td>${r.ringOutsInflicted} / ${r.ringOutsTaken}</td><td>${r.meanEnergy.toFixed(1)}</td><td>${r.meanFirstContactTick === null ? "—" : (r.meanFirstContactTick / 60).toFixed(1) + " s"}</td><td>${r.violationsPerMatch.toFixed(2)}</td><td>${r.timeouts}</td></tr>`).join("")}</tbody></table></div>`;
}
$("#export-report").onclick = () => {
  if (report) download("RESULTS.md", renderReport(report), "text/markdown");
};
$("#export-ranking").onclick = () => {
  if (report)
    download("llms-robot-arena-tournament.json", JSON.stringify(report, null, 2));
};
function stepFrame(direction, count = 1) {
  if (!viewer || !replay || operation) return;
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
    operation
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    viewer?.toggle();
  }
  if (e.code === "Home") {
    e.preventDefault();
    if (viewer) viewer.playing = false;
    viewer?.seek(0);
  }
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    stepFrame(e.code === "ArrowLeft" ? -1 : 1, e.shiftKey ? 60 : 1);
  }
});
async function loadReplayUrl(path) {
  const url = new URL(path, location.href);
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
    const url = new URL(location.href);
    url.searchParams.set("replay", path);
    history.replaceState(null, "", url);
  } catch (error) {
    toast(error.message, true);
  }
};
fetch("./replays.json")
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
loadReplayUrl(
  new URLSearchParams(location.search).get("replay") || "./demo-replay.json",
).catch((e) => {
  if (viewer) $("#stage-loading").hidden = true;
  toast(e.message + " You can simulate a new match.", true);
});
