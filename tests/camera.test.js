import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { FollowCamera } from "../packages/viewer/camera.js";

function setup(aspect) {
  const camera = new PerspectiveCamera(39, aspect, 0.1, 160);
  camera.up.set(0, 0, 1);
  return { camera, follow: new FollowCamera(camera) };
}

function assertVisible(camera, states) {
  for (const s of states) {
    // Project the chassis/flip envelope and the name anchor independently.
    const points = [new Vector3(s.x, s.y, (s.z ?? 0) + 1.25)];
    for (const x of [-0.6, 0.6])
      for (const y of [-0.6, 0.6])
        for (const z of [-0.5, 0.8])
          points.push(new Vector3(s.x + x, s.y + y, (s.z ?? 0) + z));
    for (const point of points) {
      point.project(camera);
      assert.ok(Math.abs(point.x) < 0.78, `horizontal clipping: ${point.x}`);
      assert.ok(Math.abs(point.y) < 0.64, `vertical clipping: ${point.y}`);
      assert.ok(point.z > -1 && point.z < 1, `depth clipping: ${point.z}`);
    }
  }
}

test("auto camera frames both robots at edges, diagonals and close contact on wide and portrait screens", () => {
  for (const aspect of [0.45, 0.8, 1, 1.8, 3.2]) {
    const { camera, follow } = setup(aspect);
    for (const states of [
      [{ x: -8, y: -8 }, { x: 8, y: 8 }],
      [{ x: -8, y: 8 }, { x: 8, y: -8 }],
      [{ x: 7, y: 7 }, { x: 7.8, y: 7.8 }],
      [{ x: -0.4, y: 0 }, { x: 0.4, y: 0 }],
      [{ x: 8.5, y: 0, z: -2 }, { x: 0, y: 4 }],
    ]) {
      follow.update(states, 0, true);
      assertVisible(camera, states);
      assert.equal(follow.target.x, (states[0].x + states[1].x) / 2);
      assert.equal(follow.target.y, (states[0].y + states[1].y) / 2);
    }
  }
});

test("both robots stay in view while tracking and zoom lag behind fast movement", () => {
  for (const aspect of [0.5, 1.8]) {
    const { camera, follow } = setup(aspect);
    for (let tick = 0; tick < 600; tick++) {
      const states = [
        { x: 8 * Math.sin(tick * 0.019), y: 8 * Math.cos(tick * 0.017) },
        { x: 8 * Math.cos(tick * 0.013), y: 8 * Math.sin(tick * 0.023) },
      ];
      follow.update(states, 1 / 60);
      assertVisible(camera, states);
    }
  }
});

test("seeking and resizing reframe immediately; normal playback eases toward the midpoint and closer zoom", () => {
  const { camera, follow } = setup(1.8);
  follow.update([{ x: -8, y: -8 }, { x: 8, y: 8 }]);
  const farDistance = follow.distance;
  const close = Object.freeze([Object.freeze({ x: 4, y: 4 }), Object.freeze({ x: 5, y: 4 })]);
  follow.update(close, 1 / 60);
  assert.ok(follow.target.x > 0 && follow.target.x < 4.5);
  assert.ok(follow.distance < farDistance);
  assert.ok(follow.distance > 11);
  for (let i = 0; i < 300; i++) follow.update(close, 1 / 60);
  assert.ok(Math.abs(follow.target.x - 4.5) < 0.001);
  assert.ok(Math.abs(follow.distance - 11) < 0.001);

  const opposite = [{ x: -8, y: 8 }, { x: 7, y: -8 }];
  follow.update(opposite, 0, true);
  assert.equal(follow.target.x, -0.5);
  assert.equal(follow.target.y, 0);
  camera.aspect = 0.45;
  camera.updateProjectionMatrix();
  follow.update(opposite, 0, true);
  assertVisible(camera, opposite);
});

test("manual focus chases the driven robot from behind and turns with it", () => {
  for (const aspect of [0.5, 1.8]) {
    const { camera, follow } = setup(aspect);
    follow.setFocus(0);
    const opponent = { x: -6, y: 5, heading: 0 };
    follow.update([{ x: 0, y: 0, heading: 0 }, opponent], 0, true);
    assert.ok(camera.position.x < -8, `behind: ${camera.position.x}`);
    assert.ok(Math.abs(camera.position.y) < 1e-6);
    assert.ok(camera.position.z > 5);
    assert.equal(follow.distance, 13);
    assertVisible(camera, [{ x: 0, y: 0 }]);
    // A quarter turn swings the camera around the robot, not around the arena.
    follow.update([{ x: 0, y: 0, heading: Math.PI / 2 }, opponent], 0, true);
    assert.ok(camera.position.y < -8, `behind: ${camera.position.y}`);
    assert.ok(Math.abs(camera.position.x) < 1e-6);
    assertVisible(camera, [{ x: 0, y: 0 }]);
    // Driving in circles keeps the robot framed while the view rotates.
    for (let tick = 0; tick < 600; tick++) {
      const heading = tick * 0.02;
      const state = { x: 5 * Math.cos(heading), y: 5 * Math.sin(heading), heading };
      follow.update([state, opponent], 1 / 60);
      assertVisible(camera, [state]);
    }
    follow.setFocus(null);
    const pair = [{ x: -8, y: -8 }, { x: 8, y: 8 }];
    follow.update(pair, 0, true);
    assertVisible(camera, pair);
    assert.equal(follow.target.x, 0);
  }
});

test("watching from a robot keeps its closest rival in the shot", () => {
  for (const aspect of [0.45, 1, 1.8, 3.2]) {
    const { camera, follow } = setup(aspect);
    follow.setFocus(0, { withRival: true });
    for (const opponent of [
      { x: 7.5, y: 7.5, heading: 0 },
      { x: -6, y: 0, heading: 0 },
      { x: 0, y: 7, heading: 0 },
      { x: 1.4, y: 0.3, heading: Math.PI },
      { x: -8, y: 8, heading: 0 },
    ]) {
      const driven = { x: 0, y: 0, heading: 0 };
      follow.update([driven, opponent], 0, true);
      assertVisible(camera, [driven, opponent]);
    }
    // And while both of them keep moving.
    for (let tick = 0; tick < 600; tick++) {
      const states = [
        { x: 6 * Math.sin(tick * 0.021), y: 6 * Math.cos(tick * 0.017), heading: tick * 0.02 },
        { x: 7 * Math.cos(tick * 0.013), y: 7 * Math.sin(tick * 0.024), heading: -tick * 0.03 },
      ];
      follow.update(states, 1 / 60);
      assertVisible(camera, states);
    }
  }
});

test("a rumble view stays on the chased robot and its closest rival, not on the whole roster", () => {
  const { camera, follow } = setup(1.8);
  follow.setFocus(0, { withRival: true });
  // Eleven rivals spread around the arena, one of them right alongside.
  const states = [
    { x: 0, y: 0, heading: 0 },
    { x: 2, y: 0.5, heading: Math.PI },
    ...Array.from({ length: 10 }, (_, i) => ({
      x: 7.5 * Math.cos((i / 10) * Math.PI * 2),
      y: 7.5 * Math.sin((i / 10) * Math.PI * 2),
      heading: 0,
    })),
  ];
  follow.update(states, 0, true);
  assertVisible(camera, [states[0], states[1]]);
  // Framing the far side of the arena as well would push the camera away and
  // turn the point of view into another wide shot.
  assert.ok(follow.distance < 20, `distance: ${follow.distance}`);
  // An eliminated neighbour is not the rival to frame.
  const withGhost = [states[0], { ...states[1], out: true }, ...states.slice(2)];
  follow.update(withGhost, 0, true);
  assertVisible(camera, [withGhost[0]]);
});
