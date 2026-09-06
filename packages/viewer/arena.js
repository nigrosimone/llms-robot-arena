import { botName } from "../bot-catalog.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { samplePlayback } from "./playback.js";
import { TerrainView, deckGeometry, decalGeometry } from "./terrain.js";
import { FollowCamera } from "./camera.js";
const COLORS = [0xafd965, 0xf09163];
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
function robot(color) {
  const root = new THREE.Group(),
    body = new THREE.Group();
  root.add(body);
  const metal = material(0x232a2d, 0.75, 0.38),
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
    this.last = 0;
    this.lastUI = -1;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x12171b);
    scene.fog = new THREE.FogExp2(0x12171b, 0.016);
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.1, 160);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(17, -22, 23);
    this.followCamera = new FollowCamera(this.camera);
    this.manualCamera = false;
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
    this.robots = COLORS.map((color) => {
      const r = robot(color);
      scene.add(r.root);
      return r;
    });
    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(180), 3),
    );
    this.sparks = new THREE.Points(
      sparkGeom,
      new THREE.PointsMaterial({
        color: 0xffd788,
        size: 0.08,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    scene.add(this.sparks);
    this.labels = COLORS.map((_, i) => {
      const el = document.createElement("div");
      el.className = "robot-label robot-" + i;
      el.innerHTML = "<b></b><span><i></i></span>";
      container.appendChild(el);
      return el;
    });
    this.resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.draw(0, true);
    });
    this.resize.observe(container);
    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }
  load(replay, { live = false } = {}) {
    this.replay = replay;
    this.deckKey = null;
    this.terrain.load(replay.arenaCells ?? []);
    this.time = 0;
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
    this.draw(0, true);
  }
  get duration() {
    return this.replay ? this.replay.result.ticks / 60 : 0;
  }
  get playbackDuration() {
    return (
      this.duration +
      (this.replay?.events.some((e) => e.type === "ring-out" || e.type === "hole") ? 1.5 : 0)
    );
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
  setFocus(index) {
    this.followCamera.setFocus(index);
    this.draw(0, true);
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
    this.terrain.draw(sample.cells, sample.time);
    this.edge.material.color.set(this.time >= 60 ? 0xeb9864 : 0xb7d885);
    const flips = states.map((s) => s.flips);
    for (let i = 0; i < 2; i++) {
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
      el.style.opacity = projected.z > 1 || fall > 0.7 ? "0" : "1";
      el.classList.toggle("low", lowEnergy);
      el.classList.toggle("recovering", status === 2);
    }
    // Keep both energy bars and names legible at close contact, also on mobile.
    const [first, second] = this.labels;
    const dx = Math.abs(parseFloat(first.style.left) - parseFloat(second.style.left)) * this.container.clientWidth / 100;
    const dy = Math.abs(parseFloat(first.style.top) - parseFloat(second.style.top)) * this.container.clientHeight / 100;
    if (dx < (first.offsetWidth + second.offsetWidth) / 2 + 10 && dy < 32 && first.style.opacity !== "0" && second.style.opacity !== "0") {
      const upper = parseFloat(first.style.top) <= parseFloat(second.style.top) ? first : second;
      upper.style.top = `calc(${upper.style.top} - ${32 - dy}px)`;
    }
    const impact = past
      .filter(
        (e) => e.type === "impact" && this.time - (e.tick + 1) / 60 < 0.45,
      )
      .at(-1);
    this.sparks.material.opacity = impact
      ? Math.max(0, 1 - (this.time - (impact.tick + 1) / 60) / 0.45)
      : 0;
    if (impact) {
      const age = this.time - (impact.tick + 1) / 60,
        arr = this.sparks.geometry.attributes.position.array;
      for (let i = 0; i < 60; i++) {
        const angle = i * 2.39996,
          velocity = (0.2 + (i % 7) * 0.13) * Math.min(5, impact.closingSpeed);
        arr[i * 3] = impact.x + Math.cos(angle) * age * velocity;
        arr[i * 3 + 1] = impact.y + Math.sin(angle) * age * velocity;
        arr[i * 3 + 2] =
          0.15 + Math.sin(i) * age * 0.8 + age * 2 - age * age * 6;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;
    }
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
        ended: !this.live && this.time >= this.playbackDuration,
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
