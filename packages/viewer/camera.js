import { MathUtils, Vector3 } from "three";

const AUTO_DIRECTION = [17, -22, 23];
// Chase view: behind the driven robot, high enough to read the floor ahead.
const CHASE_PITCH = 0.7;
const CHASE_DISTANCE = 13;
const CHASE_LOOKAHEAD = 1.4;
// How far the target leans toward the chased robot when the shot must also
// hold its rival: enough to feel like its point of view, not so much that the
// other robot ends up behind the camera.
const CHASE_BIAS = 0.4;
// A duel has one rival, a rumble has eleven. Framing them all would push the
// camera so far back that the point of view would be lost, so the shot holds
// the chased robot and the rival that matters: the closest one.
const nearestTo = (center, others) =>
  others.reduce(
    (best, other) => {
      const gap = Math.hypot(other.x - center.x, other.y - center.y);
      return gap < best.gap ? { center: other, gap } : best;
    },
    { center: null, gap: Infinity },
  ).center;
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
    this.withRival = false;
    this.initialized = false;
  }

  setDirection(direction) {
    this.direction.copy(direction).normalize();
    this.right.crossVectors(this.camera.up, this.direction).normalize();
    this.up.crossVectors(this.direction, this.right).normalize();
  }

  // The camera sits behind one robot and turns with it, the way a third-person
  // view does. Driving manually frames only that robot; watching a replay from
  // its point of view also holds its closest rival, which is the point of
  // offering the view at all.
  setFocus(index = null, { withRival = false } = {}) {
    this.focus = index;
    this.withRival = withRival;
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
    const drivenCenter = driven
      ? new Vector3(driven.x, driven.y, Math.max(-3.5, driven.z ?? 0))
      : null;
    let framed = centers;
    if (driven) {
      const rival = this.withRival
        ? nearestTo(drivenCenter, centers.filter((center) => !center.equals(drivenCenter)))
        : null;
      framed = rival ? [drivenCenter, rival] : [drivenCenter];
    }
    const midpoint = new Vector3();
    for (const center of framed) midpoint.add(center);
    midpoint.multiplyScalar(1 / framed.length);
    midpoint.z += 0.25;
    snap ||= !this.initialized;
    if (driven) {
      const heading = driven.heading ?? 0;
      const forward = new Vector3(Math.cos(heading), Math.sin(heading), 0);
      // Lean toward the chased robot, then look ahead of it and swing behind
      // it as it turns. The fit below still has to hold everything framed.
      if (framed.length > 1) midpoint.lerp(drivenCenter, CHASE_BIAS);
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
