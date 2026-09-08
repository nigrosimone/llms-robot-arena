import * as THREE from "three";
import { GROUND } from "./surface.js";

const vertexShader = `
  #include <common>
  #include <clipping_planes_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

const fragmentShader = `
  #include <common>
  #include <clipping_planes_pars_fragment>
  uniform vec2 seed;
  uniform float damage;
  uniform float utility;
  uniform float warning;
  uniform float remaining;
  uniform float time;
  varying vec2 vUv;

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
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0);
    return length(p - a - ab * t);
  }
  float squarePerimeter(vec2 p) {
    vec2 q = p / max(max(abs(p.x), abs(p.y)), 0.001);
    if (q.y >= abs(q.x)) return (q.x + 1.0) / 8.0;
    if (q.x >= abs(q.y)) return (3.0 - q.y) / 8.0;
    if (-q.y >= abs(q.x)) return (5.0 - q.x) / 8.0;
    return (7.0 + q.y) / 8.0;
  }

  void main() {
    #include <clipping_planes_fragment>
    vec2 p = vUv - 0.5;
    float edge = max(abs(p.x), abs(p.y));
    float aa = max(fwidth(p.x), fwidth(p.y));
    float progress = 1.0 - remaining;
    // Random warnings can affect intact floor. Reveal stress fractures during
    // their countdown too, without changing the authoritative integrity.
    float stress = max(damage, warning * (0.42 + progress * 0.58));
    float grain = noise(p * 53.0 + seed);
    float mottling = noise(p * 9.0 + seed * 0.71);
    float preserveSymbol = mix(1.0, smoothstep(0.24, 0.37, edge), utility);
    float feather = 1.0 - smoothstep(0.475, 0.5, edge);

    vec2 origin = (vec2(hash(seed + 3.7), hash(seed + 8.1)) - 0.5) * 0.28;
    float fracture = 2.0;
    float branch = 2.0;
    // Three connected, irregular fracture arms with subsidiary branches.
    // Every tile keeps the same pattern when scrubbing or replaying a match.
    for (int i = 0; i < 3; i++) {
      float arm = float(i);
      float variation = hash(seed + vec2(arm * 7.1, 4.3));
      float angle = arm * 2.094395 + hash(seed + 1.4) * 6.283185 + variation * 0.5;
      vec2 direction = vec2(cos(angle), sin(angle));
      vec2 normal = vec2(-direction.y, direction.x);
      vec2 a = origin;
      vec2 b = a + direction * 0.18 + normal * (variation - 0.5) * 0.18;
      vec2 c = a + direction * 0.37 + normal * (hash(seed + arm + 13.0) - 0.5) * 0.21;
      vec2 d = a + direction * 0.61 + normal * (hash(seed + arm + 24.0) - 0.5) * 0.23;
      vec2 e = a + direction * 0.88 + normal * (variation - 0.5) * 0.25;
      float growth = smoothstep(0.16 + arm * 0.075, 0.87 + arm * 0.045, stress);
      // Extending the tips reveals continuous cracks, rather than popping
      // disconnected strips into existence at fixed integrity thresholds.
      float distanceToArm = segment(p, a, mix(a, b, clamp(growth * 4.0, 0.0, 1.0)));
      if (growth > 0.25) distanceToArm = min(distanceToArm,
        segment(p, b, mix(b, c, clamp(growth * 4.0 - 1.0, 0.0, 1.0))));
      if (growth > 0.50) distanceToArm = min(distanceToArm,
        segment(p, c, mix(c, d, clamp(growth * 4.0 - 2.0, 0.0, 1.0))));
      if (growth > 0.75) distanceToArm = min(distanceToArm,
        segment(p, d, mix(d, e, clamp(growth * 4.0 - 3.0, 0.0, 1.0))));
      if (growth > 0.001) fracture = min(fracture, distanceToArm);
      float branching = smoothstep(0.49 + arm * 0.055, 1.0, stress);
      vec2 branchMid = b + direction * 0.08 + normal * (0.11 + variation * 0.08);
      vec2 branchEnd = branchMid + direction * 0.16 + normal * 0.06;
      if (branching > 0.001) {
        branch = min(branch, segment(p, b, mix(b, branchMid, min(branching * 2.0, 1.0))));
        if (branching > 0.5) branch = min(branch,
          segment(p, branchMid, mix(branchMid, branchEnd, branching * 2.0 - 1.0)));
      }
    }

    float width = mix(0.0020, 0.0085, stress * stress);
    float roughness = (grain - 0.5) * width * 0.7;
    float distanceToCrack = min(fracture, branch + width * 0.45) + roughness;
    float core = 1.0 - smoothstep(width, width + aa * 1.25, distanceToCrack);
    float rim = 1.0 - smoothstep(width + 0.0015, width + 0.006 + aa, distanceToCrack);
    float recess = 1.0 - smoothstep(width, width + 0.026 + stress * 0.017, distanceToCrack);
    float hotWear = smoothstep(0.60, 1.0, stress);

    float scuffAxis = p.x * 0.81 + p.y * 0.59;
    float scratch = abs(fract(scuffAxis * 59.0 + noise(p * 3.0 + seed) * 0.6) - 0.5);
    float scuffs = (1.0 - smoothstep(0.025, 0.10, scratch)) *
      smoothstep(0.46, 0.8, mottling) * damage;
    float dust = smoothstep(0.28, 0.85, mottling) * stress * 0.20;
    float rimAlpha = rim * mix(0.32, 0.74, hotWear);
    float alpha = max(max(core * 0.96, rimAlpha), max(recess * stress * 0.34, dust + scuffs * 0.24));
    vec3 color = mix(vec3(0.18, 0.17, 0.14), vec3(0.34, 0.24, 0.14), stress);
    color = mix(color, vec3(0.40, 0.28, 0.14), scuffs);
    color = mix(color, mix(vec3(0.31, 0.26, 0.17), vec3(0.87, 0.40, 0.10), hotWear), rim);
    color = mix(color, vec3(0.012, 0.019, 0.023), core);
    alpha *= preserveSymbol * feather;

    // A low perimeter countdown stays outside recharge symbols and grate
    // centers. It also remains legible when a robot occupies the tile.
    float pulse = 0.72 + 0.28 * sin(time * (6.0 + progress * 5.0));
    float border = (1.0 - smoothstep(0.007, 0.007 + aa, abs(edge - 0.466))) * warning;
    float countdown = 1.0 - smoothstep(remaining - 0.003, remaining + 0.003, squarePerimeter(p));
    float tangent = abs(p.x) > abs(p.y) ? p.y : p.x;
    float chevronPath = 0.397 + abs(fract(tangent * 6.0 + 0.5) - 0.5) * 0.075;
    float chevrons = (1.0 - smoothstep(0.003, 0.003 + aa, abs(edge - chevronPath))) *
      (1.0 - smoothstep(0.34, 0.40, abs(tangent))) * warning;
    float signal = max(border * mix(0.30, 0.94, countdown), chevrons * 0.63) * pulse;
    vec3 signalColor = mix(vec3(0.80, 0.105, 0.035), vec3(1.0, 0.54, 0.13), countdown * 0.8);
    color = mix(color, signalColor, signal / max(alpha + signal, 0.001));
    alpha = max(alpha, signal);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The decal lives just above the deck, below the lowest point of the wedge.
// It therefore uses normal depth testing, including for the warning graphics.
export class FloorWear {
  constructor(clippingPlanes) {
    this.clippingPlanes = clippingPlanes;
    this.geometry = new THREE.PlaneGeometry(0.96, 0.96);
    this.materials = new Set();
  }

  create(cell) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        seed: { value: new THREE.Vector2(cell.x + 19.37, cell.y + 37.91) },
        damage: { value: 0 },
        utility: { value: cell.type === "recharge" || cell.type === "flame" ? 1 : 0 },
        warning: { value: 0 },
        remaining: { value: 1 },
        time: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      clipping: true,
      clippingPlanes: this.clippingPlanes,
    });
    this.materials.add(material);
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = `floor-wear-${cell.id}`;
    mesh.position.z = GROUND.wear;
    mesh.visible = false;
    return mesh;
  }

  update(mesh, snapshot, time) {
    const integrity = Math.max(0, Math.min(1, snapshot?.integrity ?? 1));
    const countdown = snapshot?.collapseIn ??
      (snapshot?.type === "collapse" && snapshot?.state === "warning" ? snapshot.timeUntilChange : null);
    const warning = countdown != null;
    mesh.visible = Boolean(snapshot) && snapshot.state !== "inactive" &&
      snapshot.type !== "hole" && (integrity < 1 || warning);
    if (!mesh.visible) return;
    const uniforms = mesh.material.uniforms;
    uniforms.damage.value = 1 - integrity;
    uniforms.warning.value = warning ? 1 : 0;
    uniforms.remaining.value = warning ? Math.max(0, Math.min(1, countdown / 3)) : 1;
    uniforms.time.value = time;
  }

  dispose() {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.clear();
  }
}
