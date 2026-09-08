// Visuals are sampled from public replay data at the playhead, never wall time.
// Rebuilding bounded pools makes a paused frame and a seek to it look identical.
import * as THREE from "three";
import { ParticleField } from "./particles.js";
import { poseAt, robotHeat } from "./effect-sampling.js";
import { flamePhase } from "../sim/terrain.js";

const WINDOW = 1.8;
const RATE = 30;
const clamp = (x) => Math.max(0, Math.min(1, x));
function random(seed) {
  let value = (seed | 0) ^ 0x6d2b79f5;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

export class CombatEffects {
  constructor(scene, clippingPlanes = []) {
    this.glow = new ParticleField(scene, { count: 1600 });
    this.smoke = new ParticleField(scene, { count: 480, blending: THREE.NormalBlending });
    const geometry = new THREE.RingGeometry(0.93, 1, 64);
    this.rings = Array.from({ length: 24 }, () => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false, clippingPlanes,
      }));
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    // A fixed, small light pool gives flashes a reflection on the metal chassis.
    this.lights = Array.from({ length: 4 }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 3.5, 2);
      scene.add(light);
      return light;
    });
    this.clear();
  }
  setHeight(height) {
    this.glow.setHeight(height);
    this.smoke.setHeight(height);
  }
  clear() {
    this.glow.clear();
    this.smoke.clear();
    this.ringCursor = 0;
    this.lightCursor = 0;
    for (const ring of this.rings) ring.visible = false;
    for (const light of this.lights) light.intensity = 0;
  }
  ring(x, y, age, { color, life = 0.8, radius = 1.4, z = 0.12, rise = 0 } = {}) {
    if (age < 0 || age >= life || this.ringCursor === this.rings.length) return;
    const ring = this.rings[this.ringCursor++];
    const progress = age / life;
    ring.visible = true;
    ring.position.set(x, y, z + rise * progress);
    ring.scale.setScalar(0.24 + radius * (1 - (1 - progress) ** 2));
    ring.material.color.set(color);
    ring.material.opacity = 0.65 * (1 - progress) ** 2;
  }
  light(x, y, color, intensity, z = 0.65) {
    if (intensity <= 0 || this.lightCursor === this.lights.length) return;
    const light = this.lights[this.lightCursor++];
    light.position.set(x, y, z);
    light.color.set(color);
    light.intensity = intensity;
  }
  burst(event, replay, time) {
    const age = time - (event.tick + 1) / 60;
    if (age < 0 || age > WINDOW) return;
    const pose = Number.isInteger(event.robot) ? poseAt(replay, event.robot, (event.tick + 1) / 60) : null;
    const cell = event.cell ? replay.arenaCells?.find(c => c.id === event.cell) : null;
    const x = event.x ?? pose?.x ?? cell?.x;
    const y = event.y ?? pose?.y ?? cell?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rng = random(event.tick * 193 + (event.robot ?? 17) * 977 + Math.round(x * 71 + y * 131));
    if (event.type === "recharge" || event.type === "recovery") {
      const pickup = event.type === "recharge";
      const color = pickup ? 0x46bfff : 0x71ffc3;
      const strength = pickup ? 0.6 + 0.4 * clamp((event.amount ?? 60) / 60) : 0.65;
      this.ring(x, y, age, { color, radius: 1.45 * strength });
      this.ring(pose?.x ?? x, pose?.y ?? y, age, { color, life: 1, radius: 0.55, rise: 1.1, z: 0.18 });
      this.light(x, y, color, 5 * clamp(1 - age / 0.4));
      this.glow.emit({ x, y, z: 0.3, age, life: 0.35, size: 0.95, endSize: 0.15, color: 0xd9f6ff });
      for (let i = 0; i < (pickup ? 76 : 40); i++) {
        const angle = rng() * Math.PI * 2;
        const radius = 0.25 + rng() * 0.32;
        const velocity = (0.25 + rng() * 0.65) * strength;
        this.glow.emit({
          x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius,
          z: 0.12 + rng() * 0.25, age,
          vx: Math.cos(angle + 0.8) * velocity, vy: Math.sin(angle + 0.8) * velocity,
          vz: 0.65 + rng() * 1.65, life: 0.65 + rng() * 0.6,
          size: 0.045 + rng() * 0.085, endSize: 0.012,
          color: i % 4 ? color : 0xe3fbff, endColor: color, drag: 0.7,
        });
      }
      return;
    }
    if (event.type === "fire-damage") {
      this.glow.emit({ x, y, z: 0.4, age, life: 0.25, size: 0.8,
        endSize: 0.15, color: 0xffb938, endColor: 0xff3510, alpha: 0.55 });
      return;
    }
    const collapse = event.type === "collapse";
    const fall = event.type === "hole" || event.type === "ring-out";
    const flip = event.type === "flip";
    if (!collapse && !fall && !flip && event.type !== "impact") return;
    const speed = Math.min(6, event.closingSpeed ?? (flip ? 4 : 2));
    if (event.type === "impact" && speed < 0.35) return;
    const color = collapse || fall ? 0xd4a174 : 0xffb33f;
    if (!fall) this.ring(x, y, age, { color, life: 0.5, radius: collapse ? 1.1 : 0.6 + speed * 0.12 });
    if (!collapse && !fall) {
      this.light(x, y, 0xffb43e, (2 + speed) * clamp(1 - age / 0.18));
      this.glow.emit({ x, y, z: 0.2, age, life: 0.14, size: 0.5 + speed * 0.08,
        endSize: 0.06, color: 0xfff1c4 });
    }
    for (let i = 0; i < (collapse ? 28 : fall ? 12 : 18 + Math.round(speed * 8)); i++) {
      const angle = rng() * Math.PI * 2;
      const velocity = (0.4 + rng() * 1.5) * (0.6 + speed * 0.38);
      this.glow.emit({
        x: x + (rng() - 0.5) * (collapse ? 0.8 : 0.18),
        y: y + (rng() - 0.5) * (collapse ? 0.8 : 0.18), z: 0.16 + rng() * 0.15,
        age, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
        vz: 0.7 + rng() * 2.8, life: 0.3 + rng() * 0.55,
        size: 0.035 + rng() * 0.055, endSize: 0.008,
        color: i % 3 ? color : 0xffedbb, endColor: 0xe65c15, gravity: -7, drag: 1.3,
      });
    }
    for (let i = 0; i < (collapse ? 22 : flip ? 14 : 7); i++) {
      this.smoke.emit({
        x: x + (rng() - 0.5) * (collapse ? 0.95 : 0.4), y: y + (rng() - 0.5) * (collapse ? 0.95 : 0.4),
        z: 0.13, age, vx: (rng() - 0.5) * 1.6, vy: (rng() - 0.5) * 1.6,
        vz: collapse ? -0.2 + rng() * 0.9 : 0.3 + rng() * 0.6,
        life: 0.65 + rng() * 0.9, size: 0.18, endSize: collapse ? 0.9 : 0.65,
        color: 0x938578, endColor: 0x56565a, alpha: collapse ? 0.42 : 0.26, drag: 1.5,
      });
    }
  }
  fire(x, y, z, age, seed, strength = 1) {
    const rng = random(seed);
    for (let i = 0; i < 3; i++) {
      this.glow.emit({
        x: x + (rng() - 0.5) * 0.48, y: y + (rng() - 0.5) * 0.48, z: z + rng() * 0.22,
        age, vx: (rng() - 0.5) * 0.6, vy: (rng() - 0.5) * 0.6, vz: 0.9 + rng() * 1.5,
        life: 0.3 + rng() * 0.4, size: (0.17 + rng() * 0.2) * strength, endSize: 0.025,
        color: i % 2 ? 0xffbe45 : 0xff7120, endColor: 0xbb2308, alpha: 0.8 * strength, drag: 1.1,
      });
    }
    this.glow.emit({
      x, y, z: z + 0.2, age, vx: (rng() - 0.5) * 0.9, vy: (rng() - 0.5) * 0.9,
      vz: 1.8 + rng() * 1.6, life: 0.7 + rng() * 0.65, size: 0.045, endSize: 0.006,
      color: 0xffd576, endColor: 0xf54a15, alpha: strength, gravity: -0.7, drag: 0.4,
    });
    if (seed % 2 === 0) this.smoke.emit({
      x: x + (rng() - 0.5) * 0.35, y: y + (rng() - 0.5) * 0.35, z: z + 0.5,
      age, vx: 0.12 + rng() * 0.2, vy: (rng() - 0.5) * 0.25, vz: 0.8 + rng() * 0.5,
      life: 1.1 + rng() * 0.65, size: 0.22, endSize: 0.85,
      color: 0x68616a, endColor: 0x414650, alpha: 0.32 * strength, drag: 0.65,
    });
  }
  draw(replay, sample) {
    this.clear();
    const time = sample.visualTime;
    // Read only a short tail of public events, with a cap for large rumbles.
    const recent = [];
    for (let i = sample.events.length - 1; i >= 0; i--) {
      const event = sample.events[i];
      const age = time - (event.tick + 1) / 60;
      if (age > WINDOW) break;
      if (recent.length < 72) recent.push(event);
    }
    const accents = sample.states.map((state, i) => ({
      heat: robotHeat(state, sample.cells, recent, i, time) * clamp(1 - (time - sample.time) / 0.35), charge: 0,
    }));
    for (const event of recent) {
      if (event.type === "recharge" && accents[event.robot])
        accents[event.robot].charge = Math.max(accents[event.robot].charge,
          clamp(1 - (time - (event.tick + 1) / 60) / 0.9));
    }
    // Continuous sources use a fixed emission clock and recorded positions.
    // Their trails keep the same density at 0.5x, 8x and after scrubbing.
    const first = Math.max(0, Math.ceil((time - WINDOW) * RATE));
    const last = Math.floor(Math.min(time, sample.time) * RATE + 1e-9);
    const sources = (replay.arenaCells ?? []).filter(cell => cell.type === "flame").map(cell => {
      const snapshot = sample.cells.find(c => c.id === cell.id);
      const opening = recent.find(e => e.type === "collapse" && e.cell === cell.id);
      return { cell, snapshot, openedAt: opening ? (opening.tick + 1) / 60 :
        snapshot?.type === "hole" ? -Infinity : Infinity };
    });
    for (let frame = first; frame <= last; frame++) {
      const birth = frame / RATE, age = time - birth;
      // Sample the recorded flame schedule so smoke survives shutoff, while
      // neither the grate nor a robot gets a plume before ignition.
      const birthTick = Math.min(replay.result.ticks - 1, Math.floor(birth * 60 + 1e-9));
      const activeFlames = [];
      for (const { cell, snapshot, openedAt } of sources) {
        if (!snapshot || snapshot.state === "inactive" || birth >= openedAt) continue;
        const phase = cell.bursts ? flamePhase(cell, birthTick).state : snapshot.state;
        if (phase === "flaming") activeFlames.push({ ...cell, state: phase });
      }
      for (let i = 0; i < activeFlames.length; i++) {
        const cell = activeFlames[i];
        const rng = random(frame * 137 + Math.round(cell.x * 73 + cell.y * 191));
        if (frame % 2 === 0) this.fire(cell.x + (rng() - 0.5) * 0.55,
          cell.y + (rng() - 0.5) * 0.55, 0.12, age, frame * 31 + i * 433, 0.6);
      }
      for (let i = 0; i < sample.states.length; i++) {
        const state = poseAt(replay, i, birth);
        if (!state || state.status === 3) continue;
        const heat = robotHeat(state, activeFlames, recent, i, birth);
        if (heat > 0) this.fire(state.x, state.y, 0.3, age, frame * 53 + i * 997, heat);
        const damage = clamp(1 - state.energy / (sample.energyMax * 0.3));
        if (damage > 0 && frame % 4 === i % 4) {
          const rng = random(frame * 71 + i * 397);
          this.smoke.emit({ x: state.x, y: state.y, z: 0.4, age,
            vx: (rng() - 0.5) * 0.2, vy: (rng() - 0.5) * 0.2, vz: 0.65 + rng() * 0.4,
            life: 1.3, size: 0.14, endSize: 0.6, color: 0x78717b,
            alpha: 0.3 * damage, drag: 0.8 });
        }
      }
    }
    // Emit salient bursts last so a busy scene retains its newest pickups/hits.
    for (const event of recent.reverse()) this.burst(event, replay, time);
    for (let i = 0; i < accents.length; i++) {
      const { heat, charge } = accents[i];
      const state = sample.states[i];
      if (state.out || state.ringOut) continue;
      if (heat > 0) this.light(state.x, state.y, 0xff641b, heat * (2 + 0.4 * Math.sin(time * 29 + i)));
      else if (charge > 0) this.light(state.x, state.y, 0x3badff, charge * 2.5);
    }
    this.glow.update(0);
    this.smoke.update(0);
    return accents;
  }
}
