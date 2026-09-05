import { MathUtils, Vector3 } from "three";

// Presentation only: follow the sampled poses without changing replay state.
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new Vector3();
    this.direction = new Vector3(17, -22, 23).normalize();
    this.right = new Vector3().crossVectors(camera.up, this.direction).normalize();
    this.up = new Vector3().crossVectors(this.direction, this.right).normalize();
    this.distance = 11;
    this.initialized = false;
  }

  update(states, dt = 0, snap = false) {
    if (!states.length) return;
    // Do not chase a defeated robot below the visible ground during its fall.
    const centers = states.map(s => new Vector3(s.x, s.y, Math.max(-3.5, s.z ?? 0)));
    const midpoint = new Vector3();
    for (const center of centers) midpoint.add(center);
    midpoint.multiplyScalar(1 / centers.length);
    midpoint.z += 0.25;
    snap ||= !this.initialized;
    const follow = snap ? 1 : 1 - Math.exp(-6 * dt);
    this.target.lerp(midpoint, follow);

    const tanY = Math.tan(MathUtils.degToRad(this.camera.getEffectiveFOV()) / 2);
    const tanX = tanY * this.camera.aspect;
    let required = 0;
    // Fit every corner in both dimensions, including flips, rings and labels.
    // The inset also leaves room for the clock and controls over the viewport.
    const offset = new Vector3();
    for (const center of centers) {
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
    const desired = Math.max(11, required * 1.08);
    const zoom = snap ? 1 : 1 - Math.exp(-3 * dt);
    // Ease zoom changes, but expand immediately if either robot would be cut off.
    this.distance = Math.max(required, this.distance + (desired - this.distance) * zoom);
    this.camera.position.copy(this.target).addScaledVector(this.direction, this.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.initialized = true;
  }
}
