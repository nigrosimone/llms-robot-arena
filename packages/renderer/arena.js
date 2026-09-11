import { botName } from "../bot-catalog.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { samplePlayback, freshEvents, matchIntensity } from "./playback.js";
import { CombatEffects } from "./effects.js";
import { TerrainView, deckGeometry, decalGeometry, floorGridGeometry } from "./terrain.js";
import { GROUND } from "./surface.js";
import { FollowCamera } from "./camera.js";
import { robotColor } from "./palette.js";
function material(color, metalness = 0.4, roughness = 0.5) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}
function box(parent, w, d, h, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
// Same hue as the shell, far darker: the plating still reads as metal but it
// tells the robots apart at a glance.
function shade(color, lightness) {
  const hsl = new THREE.Color(color).getHSL({}, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.1), lightness, THREE.SRGBColorSpace);
}
function robot(color) {
  const root = new THREE.Group(),
    body = new THREE.Group();
  root.add(body);
  const metal = material(shade(color, 0.26), 0.5, 0.5),
    shell = material(color, 0.48, 0.4),
    tread = material(0x101719, 0.15, 0.8);
  box(body, 0.63, 0.49, 0.22, -0.06, 0, 0.19, shell);
  box(body, 0.52, 0.35, 0.06, -0.06, 0, 0.33, metal);
  box(body, 0.25, 0.045, 0.01, -0.08, 0, 0.365, shell);
  for (const y of [-0.26, 0.26]) {
    box(body, 0.74, 0.1, 0.2, -0.03, y, 0.13, tread);
    for (let x = -0.34; x < 0.34; x += 0.075)
      box(body, 0.027, 0.115, 0.012, x, y, 0.239, metal);
  }
  const wedgeGeo = new THREE.BufferGeometry();
  const points = [
    0.1, -0.29, 0.29, 0.4, -0.29, 0.025, 0.4, 0.29, 0.025, 0.1, 0.29, 0.29, 0.1,
    -0.29, 0.025, 0.1, 0.29, 0.025,
  ];
  wedgeGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  wedgeGeo.setIndex([
    0, 1, 2, 0, 2, 3, 0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 4, 5, 2, 4, 2, 1,
  ]);
  wedgeGeo.computeVertexNormals();
  const wedgeMaterial = material(0xe6c86e, 0.72, 0.32);
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMaterial);
  wedge.castShadow = true;
  body.add(wedge);
  for (const x of [-0.25, 0.12])
    for (const y of [-0.16, 0.16]) {
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.014, 8),
        material(0xd3d7d4, 0.8, 0.3),
      );
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(x, y, 0.366);
      body.add(bolt);
    }
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 0.23, 0.025),
    new THREE.MeshBasicMaterial({ color }),
  );
  light.position.set(-0.375, 0, 0.23);
  body.add(light);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.64, 0.66, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.position.z = GROUND.effect;
  root.add(ring);
  return { root, body, shell, ring, wedgeMaterial };
}
export class ArenaViewer {
  constructor(container, onFrame) {
    this.container = container;
    this.onFrame = onFrame;
    this.time = 0;
    this.playing = false;
    this.speed = 1;
    this.replay = null;
    this.live = false;
    // Set by the recorder: the drawing buffer can only be read in its own frame.
    this.onRender = null;
    this.last = 0;
    this.lastUI = -1;
    // Sound and particles fire once, when the playhead crosses the event.
    this.cueTime = 0;
    this.audio = null;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x12171b);
    scene.fog = new THREE.FogExp2(0x12171b, 0.016);
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.1, 160);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(17, -22, 23);
    this.followCamera = new FollowCamera(this.camera);
    this.manualCamera = false;
    // "auto" is the wide shot that follows everyone; a number locks the view
    // behind that robot.
    this.cameraView = "auto";
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    }));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    this.arenaClip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 8),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 8),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 8),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 8)];
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D arena. Automatic camera follows both robots. Enable Manual camera to orbit and zoom.",
    );
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enabled = false;
    renderer.domElement.style.touchAction = "pan-y";
    this.controls.target.set(0, 0, -0.1);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.maxTargetRadius = 12;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minPolarAngle = 0.2;
    scene.add(new THREE.HemisphereLight(0xe2efff, 0x3a4446, 2));
    const key = new THREE.DirectionalLight(0xf4f5e8, 3);
    key.position.set(-5, -9, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -12,
      right: 12,
      top: 12,
      bottom: -12,
      near: 1,
      far: 40,
    });
    key.shadow.normalBias = 0.03;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa3c1d2, 1.2);
    rim.position.set(12, 10, 5);
    scene.add(rim);
    this.platform = new THREE.Group();
    scene.add(this.platform);
    this.deck = [[0.48, -0.25, 0x333b40], [0.035, -0.0175, 0x242c30], [0.25, -0.59, 0x151c20]]
      .map(([height, z, color]) => {
        const mesh = new THREE.Mesh(deckGeometry([], height, z), material(color, 0.55, 0.72));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { height, z };
        this.platform.add(mesh);
        return mesh;
      });
    this.grid = new THREE.LineSegments(floorGridGeometry([]), new THREE.LineBasicMaterial({
      color: 0x576166, transparent: true, opacity: 0.22, depthWrite: false,
    }));
    this.platform.add(this.grid);
    const edgePoints = [
      new THREE.Vector3(-8, -8, GROUND.trim),
      new THREE.Vector3(8, -8, GROUND.trim),
      new THREE.Vector3(8, 8, GROUND.trim),
      new THREE.Vector3(-8, 8, GROUND.trim),
    ];
    this.edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      new THREE.LineBasicMaterial({ color: 0xb7d885 }),
    );
    this.platform.add(this.edge);
    const trim = new THREE.MeshBasicMaterial({ color: 0xc5df89 });
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        box(this.platform, 1.2, 0.08, 0.004, x * 7.36, y * 7.92, GROUND.inlay, trim);
        box(this.platform, 0.08, 1.2, 0.004, x * 7.92, y * 7.36, GROUND.inlay, trim);
      }
    for (let i = -7; i <= 7; i += 2)
      for (const side of [-1, 1]) {
        box(
          this.platform,
          0.45,
          0.045,
          0.11,
          i,
          side * 8.015,
          -0.21,
          material(0x626d67, 0.6, 0.5),
        );
        box(
          this.platform,
          0.045,
          0.45,
          0.11,
          side * 8.015,
          i,
          -0.21,
          material(0x626d67, 0.6, 0.5),
        );
      }
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const c = canvas.getContext("2d");
    c.clearRect(0, 0, 1024, 1024);
    c.strokeStyle = "rgba(196,209,207,.16)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(512, 512, 175, 0, Math.PI * 2);
    c.stroke();
    c.textAlign = "center";
    c.fillStyle = "rgba(194,210,211,.11)";
    c.font = "900 100px Arial";
    c.fillText("LLMS ROBOT", 512, 490);
    c.fillText("ARENA", 512, 592);
    c.font = "22px monospace";
    c.fillText("AUTONOMOUS COMBAT LAB", 512, 660);
    const decal = this.decal = new THREE.Mesh(
      decalGeometry([]),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    decal.position.z = GROUND.decal;
    this.platform.add(decal);
    this.platform.traverse(object => {
      if (object.material && object !== this.edge) {
        object.material.clippingPlanes = this.arenaClip;
        object.material.clipShadows = true;
      }
    });
    this.terrain = new TerrainView(scene, this.arenaClip);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      material(0x111619, 0.1, 0.9),
    );
    ground.position.z = -3.7;
    ground.receiveShadow = true;
    scene.add(ground);
    this.robots = [];
    this.labels = [];
    this.setRobotCount(2);
    this.effects = new CombatEffects(scene, this.arenaClip);
    // While recording the buffer keeps at least this many rows whatever the
    // stage size on screen, so the clip is not an upscaled small canvas. Full
    // 1080 rows made the render loop drop frames on an integrated GPU.
    this.minimumRows = 0;
    this.applySize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setPixelRatio(Math.max(Math.min(devicePixelRatio, 2), this.minimumRows / height));
      renderer.setSize(width, height);
      const buffer = height * renderer.getPixelRatio();
      this.effects.setHeight(buffer);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.draw(0, true);
    };
    this.resize = new ResizeObserver(this.applySize);
    this.resize.observe(container);
    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }
  // A rumble brings more than two robots: meshes and labels follow the roster.
  setMinimumRows(rows) {
    this.minimumRows = rows;
    this.applySize();
  }
  // Clip rendering: the loop stops, the buffer takes the clip size and the
  // frames are stepped one at a time with a fixed dt, from the start.
  beginOffline(width, height) {
    this.offline = true;
    this.playing = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.effects.setHeight(height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.seek(0);
  }
  renderAt(t, dt) {
    this.time = t;
    this.playing = t < this.playbackDuration;
    this.draw(dt);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }
  endOffline() {
    this.offline = false;
    this.playing = false;
    this.applySize();
  }
  setRobotCount(count) {
    // Loading a shorter roster must not leave the camera on a robot that is
    // gone. No redraw here: the replay around it is still being swapped.
    if (typeof this.cameraView === "number" && this.cameraView >= count) {
      this.cameraView = "auto";
      this.followCamera.setFocus(null);
    }
    while (this.robots.length > count) {
      const model = this.robots.pop();
      this.scene.remove(model.root);
      this.labels.pop().remove();
    }
    while (this.robots.length < count) {
      const index = this.robots.length,
        color = robotColor(index);
      const model = robot(color.mesh);
      this.scene.add(model.root);
      this.robots.push(model);
      const el = document.createElement("div");
      el.className = "robot-label robot-" + index;
      el.style.setProperty("--robot", color.css);
      el.innerHTML = "<b></b><span><i></i></span>";
      this.container.appendChild(el);
      this.labels.push(el);
    }
  }
  load(replay, { live = false } = {}) {
    this.replay = replay;
    this.setRobotCount(replay.bots.length);
    this.deckKey = null;
    this.terrain.load(replay.arenaCells ?? []);
    this.time = 0;
    this.resetEffects();
    // A live match grows while it plays: playback follows the simulated ticks.
    this.live = live;
    this.playing = live;
    this.lastUI = -1;
    this.labels.forEach(
      (l, i) => (l.querySelector("b").textContent = botName(replay.bots[i])),
    );
    this.draw(0, true);
  }
  seek(t) {
    this.time = t >= this.duration ? this.playbackDuration : Math.max(0, t);
    this.resetEffects();
    this.draw(0, true);
  }
  // Nothing from the old position may leak into the new one.
  resetEffects() {
    this.cueTime = this.time;
    this.effects.clear();
    this.audio?.reset();
  }
  get duration() {
    return this.replay ? this.replay.result.ticks / 60 : 0;
  }
  get playbackDuration() {
    if (!this.replay) return 0;
    // Falls and the deciding flip animate after the last simulated tick.
    const tail = this.replay.events.some((e) => e.type === "ring-out" || e.type === "hole")
      ? 1.5
      : this.replay.result.reason === "flips"
        ? 1
        : 0;
    return this.duration + tail;
  }
  resetCamera() {
    this.clearCameraInertia();
    this.camera.position.set(17, -22, 23);
    this.controls.target.set(0, 0, -0.1);
    if (this.replay) {
      this.followCamera.update(samplePlayback(this.replay, this.time).states, 0, true);
      this.controls.target.copy(this.followCamera.target);
    }
    this.controls.update();
    this.draw(0, true);
  }
  clearCameraInertia() {
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
  }
  setManualCamera(manual) {
    this.clearCameraInertia();
    this.manualCamera = manual;
    this.controls.enabled = manual;
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = manual ? "none" : "pan-y";
    canvas.style.cursor = manual ? "grab" : "default";
    canvas.setAttribute("aria-label", manual
      ? "3D arena. Drag to orbit, right-drag to pan; scroll or pinch to zoom."
      : "3D arena. Automatic camera follows both robots. Enable Manual camera to orbit and zoom.");
    this.draw(0, true);
  }
  // Watching a replay from a robot: the shot sits behind it and still holds
  // every robot in frame.
  setCameraView(view, { withRival = true } = {}) {
    this.cameraView = view;
    this.followCamera.setFocus(view === "auto" ? null : view, { withRival });
    this.draw(0, true);
  }
  // Driving manually frames the player alone, the way it always has.
  setFocus(index) {
    this.setCameraView(index === null ? "auto" : index, { withRival: false });
  }
  toggle() {
    if (this.time >= this.duration) this.seek(0);
    this.playing = !this.playing;
    return this.playing;
  }
  animate(now) {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    // A clip render steps the frames itself.
    if (this.offline) {
      this.raf = requestAnimationFrame(this.animate);
      return;
    }
    if (this.playing && this.replay) {
      const limit = this.live ? this.duration : this.playbackDuration;
      this.time = Math.min(limit, this.time + dt * this.speed);
      if (!this.live && this.time === limit) this.playing = false;
    }
    if (this.container.clientWidth > 0) {
      if (this.manualCamera) this.controls.update();
      this.draw(dt);
      this.renderer.render(this.scene, this.camera);
      this.onRender?.();
    }
    this.raf = requestAnimationFrame(this.animate);
  }
  draw(dt = 0, snapCamera = false) {
    const r = this.replay;
    if (!r) return;
    const sample = samplePlayback(r, this.time),
      { states, half, events: past } = sample;
    if (!this.manualCamera) {
      this.followCamera.update(states, dt, snapCamera);
      this.controls.target.copy(this.followCamera.target);
    }
    this.camera.updateMatrixWorld();
    const holes = sample.cells.filter(cell => cell.type === "hole");
    const deckKey = holes.map(cell => cell.id).join("|");
    if (deckKey !== this.deckKey) {
      for (const mesh of this.deck) {
        mesh.geometry.dispose();
        mesh.geometry = deckGeometry(holes, mesh.userData.height, mesh.userData.z);
      }
      this.decal.geometry.dispose();
      this.decal.geometry = decalGeometry(holes);
      this.grid.geometry.dispose();
      this.grid.geometry = floorGridGeometry(holes);
      this.deckKey = deckKey;
    }
    this.arenaClip.forEach(plane => { plane.constant = half; });
    const edge = this.edge.geometry.attributes.position;
    [[-half, -half], [half, -half], [half, half], [-half, half]].forEach(([x, y], i) => edge.setXYZ(i, x, y, GROUND.trim));
    edge.needsUpdate = true;
    this.edge.geometry.computeBoundingSphere();
    if (this.terrain.cells.length < (r.arenaCells?.length ?? 0))
      this.terrain.add(r.arenaCells.slice(this.terrain.cells.length));
    this.terrain.draw(sample.cells, sample.time);
    this.edge.material.color.set(this.time >= 60 ? 0xeb9864 : 0xb7d885);
    const accents = this.effects.draw(r, sample);
    this.burning = accents.reduce((sum, accent) => sum + accent.heat, 0);
    const flips = states.map((s) => s.flips);
    for (let i = 0; i < this.robots.length; i++) {
      const {
        x,
        y,
        z,
        heading,
        energy,
        status,
        rotation,
        axis,
        fall,
        fallAxis,
      } = states[i];
      const model = this.robots[i];
      model.root.position.set(x, y, z);
      model.root.rotation.z = heading;
      const toLocal = (axis) =>
        new THREE.Vector3(
          axis[0] * Math.cos(heading) + axis[1] * Math.sin(heading),
          -axis[0] * Math.sin(heading) + axis[1] * Math.cos(heading),
          0,
        ).normalize();
      model.body.quaternion.setFromAxisAngle(toLocal(axis), rotation);
      if (fall)
        model.body.quaternion.premultiply(
          new THREE.Quaternion().setFromAxisAngle(
            toLocal(fallAxis),
            fall * 2.2,
          ),
        );
      model.body.position.z =
        0.19 * (1 - Math.cos(rotation)) + 0.16 * Math.sin(rotation);
      model.ring.visible = !states[i].ringOut;
      model.ring.material.opacity =
        status === 2 ? 0.55 + 0.25 * Math.sin(this.time * 14) : 0.35;
      model.wedgeMaterial.emissive.set(status === 2 ? 0x4a8061 : 0x000000);
      const lowEnergy = energy < sample.energyMax * 0.2;
      const { heat, charge } = accents[i];
      model.shell.emissive.set(heat > 0 ? 0xff5319 : charge > 0 ? 0x168eff : lowEnergy ? 0xbd2f24 : 0x000000);
      model.shell.emissiveIntensity = heat > 0 ? heat * 0.8 : charge > 0 ? charge * 0.9 : lowEnergy ? 0.45 : 0;
      const projected = new THREE.Vector3(x, y, z + 1.25).project(this.camera),
        el = this.labels[i];
      const width = this.container.clientWidth;
      const margin = el.offsetWidth / 2 + 4;
      const labelX = Math.max(margin, Math.min(width - margin, (projected.x * 0.5 + 0.5) * width));
      el.style.left = (labelX / width) * 100 + "%";
      el.style.top = (-projected.y * 0.5 + 0.5) * 100 + "%";
      el.querySelector("i").style.width = (energy / sample.energyMax * 100) + "%";
      el.style.opacity = projected.z > 1 || fall > 0.7 || states[i].out ? "0" : "1";
      el.classList.toggle("low", lowEnergy);
      el.classList.toggle("recovering", status === 2);
    }
    // Keep both energy bars and names legible at close contact, also on mobile.
    if (this.labels.length !== 2)
      return this.drawEffects(sample, past, states, half, flips, dt);
    const [first, second] = this.labels;
    const dx = Math.abs(parseFloat(first.style.left) - parseFloat(second.style.left)) * this.container.clientWidth / 100;
    const dy = Math.abs(parseFloat(first.style.top) - parseFloat(second.style.top)) * this.container.clientHeight / 100;
    if (dx < (first.offsetWidth + second.offsetWidth) / 2 + 10 && dy < 32 && first.style.opacity !== "0" && second.style.opacity !== "0") {
      const upper = parseFloat(first.style.top) <= parseFloat(second.style.top) ? first : second;
      upper.style.top = `calc(${upper.style.top} - ${32 - dy}px)`;
    }
    return this.drawEffects(sample, past, states, half, flips, dt);
  }
  drawEffects(sample, past, states, half, flips, dt = 0) {
    const fresh = freshEvents(past, this.cueTime, this.time);
    this.cueTime = this.time;
    const ended = !this.live && this.time >= this.playbackDuration;
    if (!this.offline) this.audio?.frame(fresh, {
      burning: this.playing ? this.burning : 0,
      ended,
      playing: this.playing,
      intensity: matchIntensity({
        events: past,
        states,
        time: this.time,
        energyMax: sample.energyMax,
      }),
    });
    const uiTick = Math.floor(this.time * 60 + 1e-9);
    if (
      uiTick !== this.lastUI ||
      this.playing !== this.lastPlaying
    ) {
      this.lastUI = uiTick;
      this.lastPlaying = this.playing;
      this.onFrame?.({
        time: sample.time,
        playing: this.playing,
        states,
        half,
        flips,
        events: past,
        cells: sample.cells,
        ended,
      });
    }
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.map?.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
