import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GROUND } from "./surface.js";
import { FloorWear } from "./floor-wear.js";

// Crossed, subdivided ribbons keep the fire readable from every camera angle.
// All grates share this geometry and one material; only a time uniform changes.
function flameGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    for (let cross = 0; cross < 2; cross++) {
      const part = new THREE.PlaneGeometry(0.44, 1.18, 1, 8);
      part.rotateX(Math.PI / 2);
      part.rotateZ(Math.PI / 4 + cross * Math.PI / 2);
      part.translate((i % 3 - 1) * 0.27, (Math.floor(i / 3) - 0.5) * 0.40, 0.66);
      part.setAttribute("flamePhase", new THREE.Float32BufferAttribute(
        new Array(part.attributes.position.count).fill(i * 1.71), 1));
      parts.push(part);
    }
  }
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

function flameMaterial(clippingPlanes) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    clipping: true,
    clippingPlanes,
    vertexShader: `
      #include <common>
      #include <clipping_planes_pars_vertex>
      uniform float time;
      attribute float flamePhase;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        vUv = uv;
        vPhase = flamePhase + modelMatrix[3].x * 0.73 + modelMatrix[3].y * 1.09;
        vec3 transformed = position;
        float height = uv.y * uv.y;
        transformed.x += height * 0.085 * sin(time * 5.0 + vPhase + uv.y * 5.0);
        transformed.y += height * 0.065 * cos(time * 4.1 + vPhase + uv.y * 4.0);
        transformed.z = 0.07 + (position.z - 0.07) *
          (0.83 + 0.12 * sin(time * 9.0 + vPhase) + 0.05 * sin(time * 17.0 + vPhase));
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float time;
      varying vec2 vUv;
      varying float vPhase;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
      }
      void main() {
        #include <clipping_planes_fragment>
        vec2 flow = vec2(vUv.x * 4.0 + vPhase, vUv.y * 5.0 - time * 4.2);
        float turbulence = noise(flow) * 0.65 + noise(flow * 2.1) * 0.35;
        float bend = sin(vUv.y * 8.0 - time * 5.0 + vPhase) * vUv.y * 0.10;
        float width = max(0.02, (1.0 - vUv.y) * 0.58 + (turbulence - 0.5) * 0.20);
        float edge = abs(vUv.x - 0.5 + bend) / width;
        float body = 1.0 - smoothstep(0.35, 1.0, edge);
        float tip = 1.0 - smoothstep(0.65 + turbulence * 0.15, 1.0, vUv.y);
        float base = smoothstep(0.0, 0.08, vUv.y);
        float heat = clamp((1.0 - edge) * (1.0 - vUv.y * 0.72), 0.0, 1.0);
        vec3 color = mix(vec3(1.0, 0.065, 0.005), vec3(1.0, 0.48, 0.035), heat);
        color = mix(color, vec3(1.0, 0.88, 0.46), pow(heat, 3.0));
        float alpha = body * tip * base * (0.35 + turbulence * 0.37);
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Visual geometry only. Holes cut through all three layers of the deck.
export function deckGeometry(holes, height, z) {
  const parts = [];
  for (let y = -8; y < 8; y++) {
    let start = -8;
    for (let x = -8; x <= 8; x++) {
      const gap = x === 8 || holes.some(c => c.x === x + 0.5 && c.y === y + 0.5);
      if (gap) {
        if (x > start) parts.push(new THREE.BoxGeometry(x - start, 1, height).translate((start + x) / 2, y + 0.5, z));
        start = x + 1;
      }
    }
  }
  const geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  parts.forEach(part => part.dispose());
  return geometry;
}

export function decalGeometry(holes) {
  const parts = [];
  for (let x = -1.5; x <= 1.5; x++)
    for (let y = -1.5; y <= 1.5; y++) {
      if (holes.some(cell => cell.x === x && cell.y === y)) continue;
      const part = new THREE.PlaneGeometry(1, 1);
      const uv = part.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + x + 1.5) / 4, (uv.getY(i) + y + 1.5) / 4);
      parts.push(part.translate(x, y, 0));
    }
  const geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  parts.forEach(part => part.dispose());
  return geometry;
}

// Keep lines on supported edges; an edge between two holes has no floor left.
export function floorGridGeometry(holes) {
  const missing = new Set(holes.map(cell => `${Math.floor(cell.x)},${Math.floor(cell.y)}`));
  const solid = (x, y) => x >= -8 && x < 8 && y >= -8 && y < 8 && !missing.has(`${x},${y}`);
  const positions = [];
  for (let line = -8; line <= 8; line++) {
    for (let span = -8; span < 8; span++) {
      if (solid(line - 1, span) || solid(line, span))
        positions.push(line, span, GROUND.grid, line, span + 1, GROUND.grid);
      if (solid(span, line - 1) || solid(span, line))
        positions.push(span, line, GROUND.grid, span + 1, line, GROUND.grid);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class TerrainView {
  constructor(scene, clippingPlanes) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.clippingPlanes = clippingPlanes;
    this.cells = [];
    this.floorWear = new FloorWear(clippingPlanes);
  }
  material(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.5,
      clippingPlanes: this.clippingPlanes, clipShadows: true, ...extra });
  }
  glow(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      clippingPlanes: this.clippingPlanes });
  }
  mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  clear() {
    const geometries = new Set(), materials = new Set();
    this.root.traverse(object => {
      if (object.userData.floorWear) return;
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.floorWear.dispose();
    this.floorWear = new FloorWear(this.clippingPlanes);
    this.root.clear();
    this.cells = [];
    this.flameGeometry = null;
    this.flameMaterial = null;
  }
  load(cells) {
    this.clear();
    this.add(cells);
  }
  // A manual match creates floor tiles as the robots drive over them, so the
  // list grows while it plays.
  add(cells) {
    for (const cell of cells) {
      const group = new THREE.Group();
      group.position.set(cell.x, cell.y, 0);
      this.root.add(group);
      const record = { cell, group };
      const color = cell.type === "recharge" ? 0x3baaff : cell.type === "hole" ? 0xe4a568 : cell.type === "collapse" ? 0xff5448 : 0x64737b;
      const border = this.material(color, { emissive: color, emissiveIntensity: 0.35 });
      const half = cell.size / 2;
      for (const side of [-1, 1]) {
        this.mesh(group, new THREE.PlaneGeometry(cell.size, 0.025), border.clone(), 0, side * half, GROUND.trim);
        this.mesh(group, new THREE.PlaneGeometry(0.025, cell.size), border.clone(), side * half, 0, GROUND.trim);
      }
      border.dispose();
      record.borders = [...group.children];
      record.surface = new THREE.Group();
      group.add(record.surface);
      if (cell.type === "recharge") {
        record.pad = this.mesh(record.surface, new THREE.PlaneGeometry(0.94, 0.94),
          this.material(0x0e3c5c, { emissive: 0x148ce2, emissiveIntensity: 0.65 }), 0, 0, GROUND.pad);
        this.mesh(record.surface, new THREE.CircleGeometry(0.405, 48),
          this.material(0x092130, { metalness: 0.75, roughness: 0.32 }), 0, 0, GROUND.pad + 0.001);
        const plus = this.material(0xa0dcff, { emissive: 0x69c6ff, emissiveIntensity: 1.5 });
        record.symbol = plus;
        this.mesh(record.surface, new THREE.PlaneGeometry(0.42, 0.075), plus, 0, 0, GROUND.inlay);
        this.mesh(record.surface, new THREE.PlaneGeometry(0.075, 0.42), plus, 0, 0, GROUND.inlay);
        record.ring = this.mesh(record.surface, new THREE.RingGeometry(0.325, 0.345, 64),
          this.glow(0x53dfff, 0.8), 0, 0, GROUND.inlay);
        const arcs = [];
        for (let i = 0; i < 3; i++) {
          const arc = new THREE.RingGeometry(0.397, 0.423, 32, 1, i * Math.PI * 2 / 3, Math.PI * 0.45);
          arcs.push(arc);
        }
        record.arcs = this.mesh(record.surface, mergeGeometries(arcs), this.glow(0x72ecff, 0.85), 0, 0, GROUND.inlay);
        arcs.forEach(arc => arc.dispose());
        record.halo = this.mesh(record.surface, new THREE.RingGeometry(0.325, 0.344, 48),
          this.glow(0x67dcff, 0.2), 0, 0, GROUND.trim + 0.0005);
      } else if (cell.type === "flame") {
        record.pad = this.mesh(record.surface, new THREE.PlaneGeometry(0.96, 0.96), this.material(0x121819), 0, 0, GROUND.pad);
        for (let bar = -0.4; bar <= 0.4; bar += 0.16)
          this.mesh(record.surface, new THREE.BoxGeometry(0.06, 0.94, 0.004), this.material(0x66737b), bar, 0, GROUND.inlay);
        this.flameGeometry ??= flameGeometry();
        this.flameMaterial ??= flameMaterial(this.clippingPlanes);
        record.flames = this.mesh(record.surface, this.flameGeometry, this.flameMaterial);
      }
      if (cell.type !== "hole") {
        record.wear = this.floorWear.create(cell);
        record.wear.userData.floorWear = true;
        group.add(record.wear);
      }
      this.cells.push(record);
    }
  }
  draw(snapshots, time) {
    if (this.flameMaterial) this.flameMaterial.uniforms.time.value = time;
    for (const record of this.cells) {
      const snapshot = snapshots.find(c => c.id === record.cell.id);
      const state = snapshot?.state;
      record.group.visible = Boolean(state) && state !== "inactive";
      const borderColor = snapshot?.type === "hole" ? 0xe4a568 : snapshot?.collapseIn != null ? 0xff5448 :
        snapshot?.type === "recharge" ? 0x3baaff : 0x64737b;
      for (const edge of record.borders) {
        edge.material.color.set(borderColor);
        edge.material.emissive.set(borderColor);
      }
      record.surface.visible = snapshot?.type !== "hole";
      if (record.wear) this.floorWear.update(record.wear, snapshot, time);
      if (record.cell.type === "recharge") {
        const ready = state === "ready";
        const pulse = 0.5 + 0.5 * Math.sin(time * 3 + record.cell.x);
        record.pad.material.emissiveIntensity = ready ? 0.5 + 0.18 * pulse : 0.035;
        record.pad.material.color.set(ready ? 0x0e3c5c : 0x172c3d);
        record.symbol.emissiveIntensity = ready ? 1.1 + 0.6 * pulse : 0.08;
        record.ring.material.opacity = ready ? 0.6 + 0.3 * pulse : 0.12;
        record.arcs.material.opacity = ready ? 0.85 : 0.08;
        record.arcs.rotation.z = time * 0.65;
        const phase = ((time * 0.65 + record.cell.y * 0.13) % 1 + 1) % 1;
        record.halo.visible = ready;
        record.halo.position.z = GROUND.trim + 0.0005;
        record.halo.scale.setScalar(1 + phase * 0.3);
        record.halo.material.opacity = Math.sin(phase * Math.PI) * 0.28;
      } else if (record.cell.type === "flame") {
        record.flames.visible = state === "flaming";
        record.pad.material.emissive.set(state === "warning" ? 0xf29823 : state === "flaming" ? 0xff4712 : 0);
        record.pad.material.emissiveIntensity = state === "warning" ? 0.5 + 0.4 * Math.sin(time * 18) : 1;
      }
    }
  }
}
