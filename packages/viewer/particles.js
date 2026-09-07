// Sparks, flames and smoke. One pooled point cloud per look: the pool never
// grows during a match, so playback cannot start allocating under load.
import * as THREE from "three";

// The sprite is drawn once into a canvas: no texture file to ship or load.
let sharedSprite = null;
function sprite() {
  if (sharedSprite) return sharedSprite;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d");
  const gradient = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gradient;
  c.fillRect(0, 0, 64, 64);
  sharedSprite = new THREE.CanvasTexture(canvas);
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
  gl_FragColor = vec4(vColor.rgb, vColor.a) * texel.a;
}`;

export class ParticleField {
  constructor(scene, { count = 320, blending = THREE.AdditiveBlending } = {}) {
    this.count = count;
    this.cursor = 0;
    this.particles = Array.from({ length: count }, () => ({
      life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0,
      size: 0.1, endSize: 0.1, drag: 0, gravity: 0, alpha: 1,
      color: new THREE.Color(0xffffff),
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
    endSize = size, color = 0xffffff, alpha = 1, gravity = 0, drag = 0 }) {
    const index = this.cursor;
    this.cursor = (index + 1) % this.count;
    const p = this.particles[index];
    this.position.setXYZ(index, x, y, z);
    Object.assign(p, { life, maxLife: life, vx, vy, vz, size, endSize, alpha, gravity, drag });
    p.color.set(color);
  }
  update(dt) {
    const array = this.position.array;
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        this.size.array[i] = 0;
        this.color.array[i * 4 + 3] = 0;
        continue;
      }
      p.life -= dt;
      const fade = Math.max(0, p.life / p.maxLife);
      p.vz += p.gravity * dt;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.vz *= damp;
      array[i * 3] += p.vx * dt;
      array[i * 3 + 1] += p.vy * dt;
      array[i * 3 + 2] += p.vz * dt;
      this.size.array[i] = p.endSize + (p.size - p.endSize) * fade;
      this.color.setXYZW(i, p.color.r, p.color.g, p.color.b, p.alpha * fade);
    }
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.size.needsUpdate = true;
  }
  clear() {
    for (const p of this.particles) p.life = 0;
    this.size.array.fill(0);
    this.color.array.fill(0);
    this.size.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}
