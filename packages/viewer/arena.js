import { botName } from "../bot-catalog.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { samplePlayback, freshEvents, burnIntensity, matchIntensity } from "./playback.js";
import { ParticleField } from "./particles.js";
import { TerrainView, deckGeometry, decalGeometry } from "./terrain.js";
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
    }),
  );
  ring.position.z = 0.006;
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
    this.deck = [[0.48, -0.25, 0x333b40], [0.035, 0.005, 0x242c30], [0.25, -0.59, 0x151c20]]
      .map(([height, z, color]) => {
        const mesh = new THREE.Mesh(deckGeometry([], height, z), material(color, 0.55, 0.72));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { height, z };
        this.platform.add(mesh);
        return mesh;
      });
    const positions = [];
    for (let i = -8; i <= 8; i++) {
      positions.push(i, -8, 0.025, i, 8, 0.025, -8, i, 0.025, 8, i, 0.025);
    }
    const grid = new THREE.BufferGeometry();
    grid.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.platform.add(
      new THREE.LineSegments(
        grid,
        new THREE.LineBasicMaterial({
          color: 0x576166,
          transparent: true,
          opacity: 0.22,
        }),
      ),
    );
    const edgePoints = [
      new THREE.Vector3(-8, -8, 0.04),
      new THREE.Vector3(8, -8, 0.04),
      new THREE.Vector3(8, 8, 0.04),
      new THREE.Vector3(-8, 8, 0.04),
    ];
    this.edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      new THREE.LineBasicMaterial({ color: 0xb7d885 }),
    );
    this.platform.add(this.edge);
    const trim = new THREE.MeshBasicMaterial({ color: 0xc5df89 });
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        box(this.platform, 1.2, 0.08, 0.035, x * 7.36, y * 7.92, 0.04, trim);
        box(this.platform, 0.08, 1.2, 0.035, x * 7.92, y * 7.36, 0.04, trim);
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
    decal.position.z = 0.03;
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
    this.sparks = new ParticleField(scene, { count: 520 });
    this.smoke = new ParticleField(scene, {
      count: 320,
      blending: THREE.NormalBlending,
    });
    this.resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      const buffer = height * renderer.getPixelRatio();
      this.sparks.setHeight(buffer);
      this.smoke.setHeight(buffer);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.draw(0, true);
    });
    this.resize.observe(container);
    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }
  // A rumble brings more than two robots: meshes and labels follow the roster.
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
    this.sparks.clear();
    this.smoke.clear();
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
      this.deckKey = deckKey;
    }
    this.arenaClip.forEach(plane => { plane.constant = half; });
    const edge = this.edge.geometry.attributes.position;
    [[-half, -half], [half, -half], [half, half], [-half, half]].forEach(([x, y], i) => edge.setXYZ(i, x, y, 0.04));
    edge.needsUpdate = true;
    this.edge.geometry.computeBoundingSphere();
    if (this.terrain.cells.length < (r.arenaCells?.length ?? 0))
      this.terrain.add(r.arenaCells.slice(this.terrain.cells.length));
    this.terrain.draw(sample.cells, sample.time);
    this.edge.material.color.set(this.time >= 60 ? 0xeb9864 : 0xb7d885);
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
      model.shell.emissive.set(lowEnergy ? 0xbd2f24 : 0x000000);
      model.shell.emissiveIntensity = lowEnergy ? 0.45 : 0;
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
    // Particles run on playback time, so they slow down and freeze with it.
    const step = this.playing ? dt * this.speed : 0;
    const fresh = freshEvents(past, this.cueTime, this.time);
    this.cueTime = this.time;
    for (const event of fresh)
      if (event.type === "impact") this.spawnImpact(event);
    let burning = 0;
    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      if (state.out || state.ringOut) continue;
      const heat = burnIntensity(past, i, this.time);
      burning += heat;
      if (!step) continue;
      if (heat > 0) this.spawnFire(state, heat, step);
      const damage = 1 - state.energy / (sample.energyMax * 0.3);
      if (damage > 0) this.spawnDamageSmoke(state, damage, step);
    }
    this.sparks.update(step);
    this.smoke.update(step);
    const ended = !this.live && this.time >= this.playbackDuration;
    this.audio?.frame(fresh, {
      burning: this.playing ? burning : 0,
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
  // Contact throws sparks along the deck and lifts a little dust with them.
  spawnImpact(event) {
    const speed = Math.min(6, event.closingSpeed ?? 1);
    for (let i = 0; i < 20 + Math.round(speed * 7); i++) {
      const angle = Math.random() * Math.PI * 2,
        velocity = (0.6 + Math.random() * 1.5) * (0.6 + speed * 0.4);
      this.sparks.emit({
        x: event.x,
        y: event.y,
        z: 0.16 + Math.random() * 0.14,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        vz: 0.7 + Math.random() * 2.6,
        life: 0.3 + Math.random() * 0.5,
        size: 0.05 + Math.random() * 0.05,
        endSize: 0.012,
        color: Math.random() < 0.35 ? 0xfff3cc : 0xffab33,
        gravity: -7,
        drag: 1.3,
      });
    }
    for (let i = 0; i < 6; i++)
      this.smoke.emit({
        x: event.x + (Math.random() - 0.5) * 0.3,
        y: event.y + (Math.random() - 0.5) * 0.3,
        z: 0.14,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
        vz: 0.35 + Math.random() * 0.4,
        life: 0.5 + Math.random() * 0.4,
        size: 0.18,
        endSize: 0.55,
        color: 0x7c756c,
        alpha: 0.3,
        drag: 2.2,
      });
  }
  // A robot standing in a flame burns: a plume out of the shell plus smoke.
  spawnFire(state, heat, dt) {
    const flames = Math.floor(80 * heat * dt + Math.random());
    for (let i = 0; i < flames; i++)
      this.sparks.emit({
        x: state.x + (Math.random() - 0.5) * 0.55,
        y: state.y + (Math.random() - 0.5) * 0.55,
        z: 0.2 + Math.random() * 0.25,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        vz: 1.1 + Math.random() * 1.3,
        life: 0.35 + Math.random() * 0.35,
        size: 0.16 + Math.random() * 0.16,
        endSize: 0.03,
        color: Math.random() < 0.4 ? 0xffd977 : 0xff5a1e,
        alpha: 0.9,
        drag: 1.5,
      });
    const puffs = Math.floor(22 * heat * dt + Math.random());
    for (let i = 0; i < puffs; i++)
      this.smoke.emit({
        x: state.x + (Math.random() - 0.5) * 0.4,
        y: state.y + (Math.random() - 0.5) * 0.4,
        z: 0.5 + Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        vz: 1 + Math.random() * 0.7,
        life: 1 + Math.random() * 0.8,
        size: 0.22,
        endSize: 0.95,
        color: 0x4a443e,
        alpha: 0.42,
        drag: 0.9,
      });
  }
  // A nearly flat battery smokes on its own, even away from the grates.
  spawnDamageSmoke(state, damage, dt) {
    const puffs = Math.floor(9 * Math.min(1, damage) * dt + Math.random() * 0.6);
    for (let i = 0; i < puffs; i++)
      this.smoke.emit({
        x: state.x + (Math.random() - 0.5) * 0.3,
        y: state.y + (Math.random() - 0.5) * 0.3,
        z: 0.4,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        vz: 0.7 + Math.random() * 0.5,
        life: 0.9 + Math.random() * 0.6,
        size: 0.14,
        endSize: 0.6,
        color: 0x6d655d,
        alpha: 0.3,
        drag: 1,
      });
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
