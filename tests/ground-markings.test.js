import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Scene } from "three";
import { TerrainView, floorGridGeometry } from "../packages/renderer/terrain.js";
import { CombatEffects } from "../packages/renderer/effects.js";

const epsilon = 1e-7;
const hole = (x, y) => ({ id: `hole-${x}-${y}`, type: "hole", x, y, size: 1 });

test("cell art stays below the robot wedge throughout wear, warnings and charger pulses", () => {
  for (const type of ["floor", "collapse", "recharge", "flame", "hole"]) {
    const scene = new Scene();
    const view = new TerrainView(scene, []);
    const cell = { id: `${type}-0`, type, x: 0.5, y: 0.5, size: 1 };
    view.load([cell]);
    const states = type === "recharge" ? ["ready", "cooldown"] :
      type === "hole" ? ["hole"] : type === "collapse" ? ["warning"] : ["safe", "warning"];
    for (const state of states) {
      for (const integrity of [1, 0.5, 0]) {
        for (const time of [0, 0.25, 0.75, 1.2, 1.5, 2.3]) {
          view.draw([{ ...cell, state, integrity,
            collapseIn: type !== "hole" && (state === "warning" || integrity === 0) ? 1.5 : null,
            timeUntilChange: state === "cooldown" ? 4 : null }], time);
          scene.updateMatrixWorld(true);
          let visibleMeshes = 0;
          scene.traverseVisible(object => {
            if (!object.isMesh) return;
            visibleMeshes++;
            const bounds = new Box3().setFromObject(object);
            assert.ok(bounds.max.z <= 0.012 + epsilon,
              `${type}/${state} at ${time}s has ground art at z=${bounds.max.z}; the wedge tip is at z=0.025`);
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              assert.equal(material.depthTest, true, "ground art must respect robot occlusion");
            }
          });
          assert.ok(visibleMeshes > 0, `${type}/${state} has visible ground geometry`);
        }
      }
    }
    view.clear();
  }
});

// Test segment coverage rather than buffer order, allowing adjoining supported
// edges to share vertices or be merged into longer segments.
function covers(geometry, x, y) {
  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  for (let i = 0; i < (index?.count ?? positions.count); i += 2) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const ax = positions.getX(a), ay = positions.getY(a);
    const bx = positions.getX(b), by = positions.getY(b);
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < epsilon &&
        x >= Math.min(ax, bx) - epsilon && x <= Math.max(ax, bx) + epsilon &&
        y >= Math.min(ay, by) - epsilon && y <= Math.max(ay, by) + epsilon) return true;
  }
  return false;
}

test("grid removes unsupported edges between open holes and restores them on rewind", () => {
  const holes = [hole(0.5, 0.5), hole(1.5, 0.5), hole(0.5, 1.5), hole(7.5, -7.5)];
  for (const open of [[], holes, []]) {
    const geometry = floorGridGeometry(open);
    assert.equal(covers(geometry, 1, 0.5), open.length === 0, "vertical shared hole edge");
    assert.equal(covers(geometry, 0.5, 1), open.length === 0, "horizontal shared hole edge");
    assert.equal(covers(geometry, 8, -7.5), open.length === 0, "unsupported outer edge");
    assert.equal(covers(geometry, 0, 0.5), true, "a hole rim retains its supported neighbor");
    assert.equal(covers(geometry, 2, 0.5), true, "another exposed hole rim remains");
    assert.equal(covers(geometry, -4, -3.5), true, "ordinary floor retains its grid");
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      assert.ok(positions.getZ(i) > 0 && positions.getZ(i) <= 0.012,
        "grid stays above the deck and below the robot wedge");
    }
    geometry.dispose();
  }
});

test("pickup, recovery and impact rings expand on the floor without crossing the wedge", () => {
  const scene = new Scene(), effects = new CombatEffects(scene);
  const frame = [0.5, 0.5, 0, 200, 0, 0, -3, -3, 0, 200, 0, 0];
  const replay = { initialFrame: frame, frames: new Float32Array(frame), result: { ticks: 1 } };
  for (const type of ["recharge", "recovery", "impact"]) {
    const event = { type, tick: 0, robot: 0, x: 0.5, y: 0.5, amount: 60, closingSpeed: 4 };
    for (const age of [0.02, 0.2, 0.45]) {
      effects.clear();
      effects.burst(event, replay, 1 / 60 + age);
      scene.updateMatrixWorld(true);
      const rings = effects.rings.filter(ring => ring.visible);
      assert.ok(rings.length > 0, `${type} still has a visible ring at age ${age}`);
      for (const ring of rings) {
        const bounds = new Box3().setFromObject(ring);
        assert.ok(bounds.min.z > 0 && bounds.max.z < 0.025,
          `${type} ring at age ${age} must remain above the deck and below the wedge tip`);
        assert.equal(ring.material.depthTest, true);
        assert.ok(ring.material.opacity > 0);
      }
    }
  }
});

test("wear progresses independently of collapse warnings and reproduces exact rewind state", () => {
  const view = new TerrainView(new Scene(), []);
  const cells = ["floor", "recharge", "flame"].map((type, i) => ({
    id: `${type}-0`, type, x: i + 0.5, y: 0.5, size: 1,
  }));
  view.load(cells);
  const snapshots = (integrity, collapseIn = null) => cells.map(cell => ({ ...cell, integrity, collapseIn,
    state: cell.type === "recharge" ? "ready" : cell.type === "flame" ? "flaming" : "safe",
    timeUntilChange: null }));
  const appearance = () => view.cells.map(({ wear }) => ({
    visible: wear.visible,
    damage: wear.material.uniforms.damage.value,
    warning: wear.material.uniforms.warning.value,
    remaining: wear.material.uniforms.remaining.value,
    time: wear.material.uniforms.time.value,
    utility: wear.material.uniforms.utility.value,
    seed: wear.material.uniforms.seed.value.toArray(),
  }));
  view.draw(snapshots(1), 0);
  assert.ok(view.cells.every(({ wear }) => !wear.visible), "fresh floor has no damage decal");
  view.draw(snapshots(0.8), 2);
  const lightWear = appearance();
  view.draw(snapshots(0.4), 6);
  const worn = appearance();
  worn.forEach((state, i) => {
    assert.equal(state.visible, true);
    assert.ok(state.damage > lightWear[i].damage, "crack progression follows cumulative wear");
    assert.equal(state.warning, 0, "wear alone does not invent a collapse warning");
    assert.equal(state.utility, i === 0 ? 0 : 1, "utility pads keep their distinct decal treatment");
  });

  view.draw(snapshots(1, 3), 8);
  assert.ok(appearance().every(state => state.visible && state.damage === 0 && state.warning === 1),
    "a random collapse warns even when the floor was intact");
  view.draw(snapshots(1, 1), 10);
  assert.ok(appearance().every(state => state.remaining === 1 / 3));
  assert.equal(view.cells[1].surface.visible, true, "a charger stays visible during a warning");
  assert.ok(view.cells[1].symbol.emissiveIntensity > 0.5, "a ready charger still illuminates its symbol");
  assert.equal(view.cells[2].flames.visible, true, "a burning grate keeps its flames while the floor warns");

  view.draw(cells.map(cell => ({ ...cell, type: "hole", state: "hole", integrity: 0, collapseIn: null })), 11);
  assert.ok(view.cells.every(({ wear, surface }) => !wear.visible && !surface.visible));
  view.draw(snapshots(0.4), 6);
  assert.deepEqual(appearance(), worn, "rewind restores the same crack and warning state");
  view.draw([], 0);
  assert.ok(view.cells.every(({ wear, group }) => !wear.visible && !group.visible),
    "rewinding before a floor cell was exposed leaves no stale warning");
  view.clear();
});

test("clearing terrain disposes shared wear geometry and each material once", () => {
  const view = new TerrainView(new Scene(), []);
  view.load(["floor", "recharge", "flame"].map((type, i) => ({
    id: `${type}-0`, type, x: i + 0.5, y: 0.5, size: 1,
  })));
  const wear = view.cells.map(cell => cell.wear);
  assert.equal(new Set(wear.map(mesh => mesh.geometry)).size, 1, "wear decals reuse one geometry");
  let geometryDisposals = 0;
  wear[0].geometry.addEventListener("dispose", () => geometryDisposals++);
  const materialDisposals = wear.map(() => 0);
  wear.forEach((mesh, i) => mesh.material.addEventListener("dispose", () => materialDisposals[i]++));
  view.clear();
  assert.equal(geometryDisposals, 1);
  assert.deepEqual(materialDisposals, [1, 1, 1]);
  assert.equal(view.root.children.length, 0);
  view.clear();
  assert.equal(geometryDisposals, 1, "a later replay cannot dispose the former geometry again");
  assert.deepEqual(materialDisposals, [1, 1, 1]);
});
