// Sparks, flames and smoke. One pooled point cloud per look: the pool never
// grows during a match, so playback cannot start allocating under load.
import * as THREE from "three";

// Generate one soft sprite without a DOM or an external texture dependency.
let sharedSprite = null;
function sprite() {
  if (sharedSprite) return sharedSprite;
  const side = 64;
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const radius = Math.hypot((x + 0.5) / side * 2 - 1, (y + 0.5) / side * 2 - 1);
      const alpha = radius <= 0.35 ? 1 - radius * (0.4 / 0.35) : (1 - radius) * (0.6 / 0.65);
      const i = (y * side + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, alpha) * 255);
    }
  }
  sharedSprite = new THREE.DataTexture(data, side, side);
  sharedSprite.minFilter = sharedSprite.magFilter = THREE.LinearFilter;
  sharedSprite.needsUpdate = true;
  return sharedSprite;
}

// Point size follows the perspective divide, so a particle keeps its world size.
const VERTEX = `
attribute float aSize;
attribute vec4 aColor;
uniform float uHeight;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uHeight * 0.5 * projectionMatrix[1][1] / max(0.1, -view.z);
  gl_Position = projectionMatrix * view;
}`;
const FRAGMENT = `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 texel = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * texel.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class ParticleField {
  constructor(scene, { count = 320, blending = THREE.AdditiveBlending } = {}) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError("Particle count must be a positive integer");
    this.count = count;
    this.cursor = 0;
    this.particles = Array.from({ length: count }, () => ({
      life: 0, maxLife: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      size: 0.1, endSize: 0.1, drag: 0, gravity: 0, alpha: 1,
      color: new THREE.Color(0xffffff), endColor: new THREE.Color(0xffffff),
    }));
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(count * 4), 4);
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1);
    geometry.setAttribute("position", this.position);
    geometry.setAttribute("aColor", this.color);
    geometry.setAttribute("aSize", this.size);
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: sprite() }, uHeight: { value: 720 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending,
      }),
    );
    // Particles live wherever the action is, so no bounding volume is useful.
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  setHeight(height) {
    this.points.material.uniforms.uHeight.value = height;
  }
  // The oldest slot is recycled: a long burst never starves a later one.
  emit({ x, y, z, vx = 0, vy = 0, vz = 0, life = 0.5, size = 0.1,
    endSize = size, color = 0xffffff, endColor = color, alpha = 1, gravity = 0, drag = 0, age = 0 }) {
    life = Math.max(0, life);
    age = Math.max(0, age);
    // Replay windows include expired bursts. They must not evict live trails.
    if (age >= life) return;
    const index = this.cursor;
    this.cursor = (index + 1) % this.count;
    const p = this.particles[index];
    this.position.setXYZ(index, x, y, z);
    Object.assign(p, { life: life - age, maxLife: life, age, x, y, z,
      vx, vy, vz, size: Math.max(0, size), endSize: Math.max(0, endSize),
      alpha: Math.max(0, Math.min(1, alpha)), gravity, drag: Math.max(0, drag) });
    p.color.set(color);
    p.endColor.set(endColor);
  }
  update(dt) {
    dt = Math.max(0, dt);
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.maxLife <= 0) {
        this.size.array[i] = 0;
        this.color.array[i * 4 + 3] = 0;
        continue;
      }
      p.age = Math.min(p.maxLife, p.age + dt);
      p.life = p.maxLife - p.age;
      const fade = p.life / p.maxLife;
      // Solve dv/dt = gravity - drag * v from the original emission. Sampling
      // an old burst after seeking therefore matches ordinary playback exactly.
      const t = p.age;
      const dragTime = p.drag * t;
      let travel, fall;
      if (dragTime < 0.0001) {
        // The series avoids cancellation in (t - travel) for tiny drag values.
        travel = t * (1 - dragTime / 2 + dragTime * dragTime / 6);
        fall = t * t * (0.5 - dragTime / 6 + dragTime * dragTime / 24);
      } else {
        travel = -Math.expm1(-dragTime) / p.drag;
        fall = (t - travel) / p.drag;
      }
      this.position.setXYZ(i, p.x + p.vx * travel, p.y + p.vy * travel,
        p.z + p.vz * travel + p.gravity * fall);
      this.size.array[i] = p.life > 0 ? p.endSize + (p.size - p.endSize) * fade : 0;
      this.color.setXYZW(i,
        p.endColor.r + (p.color.r - p.endColor.r) * fade,
        p.endColor.g + (p.color.g - p.endColor.g) * fade,
        p.endColor.b + (p.color.b - p.endColor.b) * fade,
        p.alpha * fade);
    }
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.size.needsUpdate = true;
  }
  clear() {
    this.cursor = 0;
    for (const p of this.particles) p.life = p.maxLife = p.age = 0;
    this.position.array.fill(0);
    this.size.array.fill(0);
    this.color.array.fill(0);
    this.position.needsUpdate = true;
    this.size.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}
