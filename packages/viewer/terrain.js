import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

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

export class TerrainView {
  constructor(scene, clippingPlanes) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.clippingPlanes = clippingPlanes;
    this.cells = [];
  }
  material(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.5,
      clippingPlanes: this.clippingPlanes, clipShadows: true, ...extra });
  }
  mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  clear() {
    this.root.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    this.root.clear();
    this.cells = [];
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
        this.mesh(group, new THREE.BoxGeometry(cell.size, 0.035, 0.025), border.clone(), 0, side * half, 0.046);
        this.mesh(group, new THREE.BoxGeometry(0.035, cell.size, 0.025), border.clone(), side * half, 0, 0.046);
      }
      border.dispose();
      record.borders = [...group.children];
      record.surface = new THREE.Group();
      group.add(record.surface);
      if (cell.type === "recharge") {
        record.pad = this.mesh(record.surface, new THREE.PlaneGeometry(0.94, 0.94),
          this.material(0x1263a5, { emissive: 0x1698ff, emissiveIntensity: 1 }), 0, 0, 0.03);
        const plus = this.material(0xa0dcff, { emissive: 0x69c6ff, emissiveIntensity: 1.5 });
        this.mesh(record.surface, new THREE.BoxGeometry(0.48, 0.09, 0.018), plus, 0, 0, 0.055);
        this.mesh(record.surface, new THREE.BoxGeometry(0.09, 0.48, 0.018), plus.clone(), 0, 0, 0.055);
      } else if (cell.type === "flame") {
        record.pad = this.mesh(record.surface, new THREE.PlaneGeometry(0.96, 0.96), this.material(0x121819), 0, 0, 0.03);
        for (let bar = -0.4; bar <= 0.4; bar += 0.16)
          this.mesh(record.surface, new THREE.BoxGeometry(0.06, 0.94, 0.035), this.material(0x66737b), bar, 0, 0.065);
        record.flames = new THREE.Group();
        record.surface.add(record.flames);
        for (let i = 0; i < 7; i++) {
          const mat = this.material(i % 2 ? 0xffba35 : 0xff6b1a, { emissive: 0xff6311, emissiveIntensity: 2,
            transparent: true, opacity: 0.8, depthWrite: false });
          const jet = this.mesh(record.flames, new THREE.ConeGeometry(0.10, 0.9, 7), mat,
            (i % 3 - 1) * 0.27, (Math.floor(i / 3) - 1) * 0.27, 0.5);
          jet.rotation.x = Math.PI / 2;
        }
      }
      if (cell.type !== "hole") {
        record.wear = new THREE.Group();
        group.add(record.wear);
        record.tint = this.mesh(record.wear, new THREE.PlaneGeometry(0.94, 0.94),
          this.material(0xd58c3b, { transparent: true, opacity: 0, depthWrite: false }), 0, 0, 0.09);
        record.cracks = [];
        for (let i = 0; i < 6; i++) {
          const crack = this.mesh(record.wear, new THREE.BoxGeometry(0.20 + i * 0.035, 0.022, 0.008),
            this.material(0x291d13), (i % 3 - 1) * 0.19, (Math.floor(i / 3) - 0.5) * 0.32, 0.10);
          crack.rotation.z = i * 1.13;
          record.cracks.push(crack);
        }
        record.warning = new THREE.Group();
        group.add(record.warning);
        record.warningPad = this.mesh(record.warning, new THREE.PlaneGeometry(0.96, 0.96),
          this.material(0x66231f, { emissive: 0xff2515, emissiveIntensity: 1, transparent: true, opacity: 0.7 }), 0, 0, 0.115);
        for (const angle of [-Math.PI / 4, Math.PI / 4]) {
          const stripe = this.mesh(record.warning, new THREE.BoxGeometry(0.85, 0.06, 0.018),
            this.material(0xffd3b2, { emissive: 0xffa57b, emissiveIntensity: 0.8 }), 0, 0, 0.13);
          stripe.rotation.z = angle;
        }
      }
      this.cells.push(record);
    }
  }
  draw(snapshots, time) {
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
      if (record.wear) {
        const damage = 1 - (snapshot?.integrity ?? 1);
        record.wear.visible = damage > 0 && snapshot?.type !== "hole";
        record.tint.material.opacity = damage * 0.4;
        record.cracks.forEach((crack, i) => { crack.visible = damage >= (i + 1) / 8; });
        record.warning.visible = snapshot?.collapseIn != null;
        record.warningPad.material.emissiveIntensity = 0.45 + 1.05 * (0.5 + 0.5 * Math.sin(time * 18));
      }
      if (record.cell.type === "recharge") {
        record.pad.material.emissiveIntensity = state === "ready" ? 0.9 + 0.2 * Math.sin(time * 3) : 0.06;
        record.pad.material.color.set(state === "ready" ? 0x1263a5 : 0x172c3d);
      } else if (record.cell.type === "flame") {
        record.flames.visible = state === "flaming";
        record.pad.material.emissive.set(state === "warning" ? 0xf29823 : state === "flaming" ? 0xff4712 : 0);
        record.pad.material.emissiveIntensity = state === "warning" ? 0.5 + 0.4 * Math.sin(time * 18) : 1;
        record.flames.children.forEach((jet, i) => {
          jet.scale.y = 0.8 + 0.35 * Math.sin(time * 17 + i * 2.1);
        });
      }
    }
  }
}
