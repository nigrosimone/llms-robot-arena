import { MathUtils, Vector3 } from "three";

const AUTO_DIRECTION = [17, -22, 23];
// Chase view: behind the driven robot, high enough to read the floor ahead.
const CHASE_PITCH = 0.7;
const CHASE_DISTANCE = 13;
const CHASE_LOOKAHEAD = 1.4;

// Presentation only: follow the sampled poses without changing replay state.
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new Vector3();
    this.direction = new Vector3();
    this.right = new Vector3();
    this.up = new Vector3();
    this.setDirection(new Vector3(...AUTO_DIRECTION));
    this.distance = 11;
    this.minDistance = 11;
    this.focus = null;
    this.initialized = false;
  }

  setDirection(direction) {
    this.direction.copy(direction).normalize();
    this.right.crossVectors(this.camera.up, this.direction).normalize();
    this.up.crossVectors(this.direction, this.right).normalize();
  }

  // Manual mode drives one robot: the camera sits behind it, turns with it and
  // frames only that robot, the way a third-person view does.
  setFocus(index = null) {
    this.focus = index;
    this.minDistance = index === null ? 11 : CHASE_DISTANCE;
    if (index === null) this.setDirection(new Vector3(...AUTO_DIRECTION));
  }

  update(states, dt = 0, snap = false) {
    if (!states.length) return;
    // Do not chase a defeated robot below the visible ground during its fall,
    // and stop framing robots a rumble has already eliminated.
    const inPlay = states.filter(s => !s.out);
    const framedStates = inPlay.length ? inPlay : states;
    const centers = framedStates.map(s => new Vector3(s.x, s.y, Math.max(-3.5, s.z ?? 0)));
    const driven = states[this.focus] && !states[this.focus].out ? states[this.focus] : null;
    const framed = driven
      ? [new Vector3(driven.x, driven.y, Math.max(-3.5, driven.z ?? 0))]
      : centers;
    const midpoint = new Vector3();
    for (const center of framed) midpoint.add(center);
    midpoint.multiplyScalar(1 / framed.length);
    midpoint.z += 0.25;
    snap ||= !this.initialized;
    if (driven) {
      const heading = driven.heading ?? 0;
      const forward = new Vector3(Math.cos(heading), Math.sin(heading), 0);
      // Look ahead of the robot, and swing behind it as it turns.
      midpoint.addScaledVector(forward, CHASE_LOOKAHEAD);
      const behind = forward.clone().negate().setZ(CHASE_PITCH).normalize();
      const swing = snap ? 1 : 1 - Math.exp(-5 * dt);
      this.setDirection(this.direction.clone().lerp(behind, swing));
    }
    const follow = snap ? 1 : 1 - Math.exp(-6 * dt);
    this.target.lerp(midpoint, follow);

    const tanY = Math.tan(MathUtils.degToRad(this.camera.getEffectiveFOV()) / 2);
    const tanX = tanY * this.camera.aspect;
    let required = 0;
    // Fit every corner in both dimensions, including flips, rings and labels.
    // The inset also leaves room for the clock and controls over the viewport.
    const offset = new Vector3();
    for (const center of framed) {
      for (const x of [-0.75, 0.75]) {
        for (const y of [-0.75, 0.75]) {
          for (const z of [-0.7, 1.65]) {
            offset.copy(center).add(new Vector3(x, y, z)).sub(this.target);
            const depth = offset.dot(this.direction);
            required = Math.max(required,
              depth + Math.abs(offset.dot(this.right)) / (tanX * 0.78),
              depth + Math.abs(offset.dot(this.up)) / (tanY * 0.64));
          }
        }
      }
    }
    const desired = Math.max(this.minDistance, required * 1.08);
    const zoom = snap ? 1 : 1 - Math.exp(-3 * dt);
    // Ease zoom changes, but expand immediately if either robot would be cut off.
    this.distance = Math.max(required, this.distance + (desired - this.distance) * zoom);
    this.camera.position.copy(this.target).addScaledVector(this.direction, this.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.initialized = true;
  }
}
