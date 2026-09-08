import test from "node:test";
import assert from "node:assert/strict";
import { Scene } from "three";
import { ParticleField } from "../packages/viewer/particles.js";

function field(count = 4) {
  return new ParticleField(new Scene(), { count });
}

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Number.isFinite(actual[i]), `non-finite buffer element ${i}`);
    assert.ok(Math.abs(actual[i] - expected[i]) < tolerance,
      `buffer element ${i}: ${actual[i]} differs from ${expected[i]}`);
  }
}

function snapshot(pool) {
  return [pool.position, pool.size, pool.color].map(attribute => Array.from(attribute.array));
}

test("particle sprites are shared radial data textures and need no browser canvas", () => {
  const first = field(), second = field();
  const texture = first.points.material.uniforms.uMap.value;
  assert.equal(texture, second.points.material.uniforms.uMap.value);
  assert.equal(texture.isDataTexture, true);
  const { data, width, height } = texture.image;
  assert.equal(data.length, width * height * 4);
  assert.equal(data[3], 0);
  assert.ok(data[((height / 2) * width + width / 2) * 4 + 3] > 240);
  for (let i = 0; i < data.length; i += 4) {
    assert.deepEqual(Array.from(data.subarray(i, i + 3)), [255, 255, 255]);
  }
  first.setHeight(1080);
  assert.equal(first.points.material.uniforms.uHeight.value, 1080);
});

test("aged emission matches partitioned playback with and without drag", () => {
  for (const drag of [0, 1e-9, 0.7, 5]) {
    const direct = field(), playback = field();
    const emission = { x: 1.5, y: -2, z: 0.3, vx: -3, vy: 1.2, vz: 2.4,
      gravity: -7, drag, life: 1.5, size: 0.2, endSize: 0.8,
      color: 0xff6800, endColor: 0x202040, alpha: 0.6 };
    direct.emit({ ...emission, age: 0.83 });
    direct.update(0);
    playback.emit(emission);
    for (const dt of [0.13, 0.07, 0.2, 0.11, 0.32]) playback.update(dt);
    const expected = snapshot(direct);
    snapshot(playback).forEach((buffer, index) => assertClose(buffer, expected[index]));
    playback.update(0);
    snapshot(playback).forEach((buffer, index) => assertClose(buffer, expected[index]));
  }
});

test("gravity, lifetime fade, size and color are sampled at the requested age", () => {
  const pool = field(1);
  pool.emit({ x: 1, y: 2, z: 3, vx: 4, vy: -2, vz: 5,
    gravity: -8, life: 2, age: 0.5, size: 0.2, endSize: 0.6,
    color: 0xff0000, endColor: 0x0000ff, alpha: 0.8 });
  pool.update(0);
  assertClose(pool.position.array, [3, 1, 4.5]);
  assertClose(pool.size.array, [0.3]);
  assertClose(pool.color.array, [0.75, 0, 0.25, 0.6]);
});

test("expired and nonpositive lifetime particles stay invisible with finite geometry", () => {
  const pool = field(3);
  pool.emit({ x: 1, y: 2, z: 3, life: 0, size: -1, alpha: -1 });
  pool.emit({ x: 2, y: 3, z: 4, life: -1 });
  pool.emit({ x: 3, y: 4, z: 5, life: 0.5, age: 2, vx: 3, gravity: -8 });
  pool.update(0);
  assert.deepEqual(Array.from(pool.size.array), [0, 0, 0]);
  for (const index of [3, 7, 11]) assert.equal(pool.color.array[index], 0);
  const expired = snapshot(pool);
  pool.update(100);
  assert.deepEqual(snapshot(pool), expired);
  pool.emit({ x: 0, y: 0, z: 0, life: 1, size: -2, endSize: -1, alpha: -3 });
  pool.update(0.5);
  for (const buffer of snapshot(pool)) assert.ok(buffer.every(Number.isFinite));
  assert.ok(Array.from(pool.size.array).every(size => size >= 0));
  assert.ok(Array.from(pool.color.array).filter((_, index) => index % 4 === 3).every(alpha => alpha >= 0));
});

test("burst overflow reuses a fixed pool and clear restores deterministic emission order", () => {
  const pool = field(4);
  const storage = [pool.position.array, pool.size.array, pool.color.array];
  const particles = [...pool.particles];
  for (let i = 0; i < 10; i++) pool.emit({ x: i, y: -i, z: 0, life: 1 });
  pool.update(0);
  assert.equal(pool.particles.length, 4);
  assertClose(pool.position.array, [8, -8, 0, 9, -9, 0, 6, -6, 0, 7, -7, 0]);
  assert.equal(pool.position.array, storage[0]);
  assert.equal(pool.size.array, storage[1]);
  assert.equal(pool.color.array, storage[2]);
  particles.forEach((particle, index) => assert.equal(pool.particles[index], particle));
  pool.update(2);
  assert.ok(Array.from(pool.size.array).every(size => size === 0));
  pool.clear();
  pool.update(0);
  assert.equal(pool.cursor, 0);
  assert.ok(snapshot(pool).every(buffer => buffer.every(value => value === 0)));
  const fresh = field(4);
  const replayEmission = { x: 2, y: 4, z: 0.2, vx: 2, vz: 1,
    drag: 0.8, age: 0.3, color: 0x00ff99, endColor: 0x003322 };
  for (const target of [pool, fresh]) {
    target.emit(replayEmission);
    target.update(0);
  }
  assert.deepEqual(snapshot(pool), snapshot(fresh));
});

test("rebuilding expired bursts cannot evict live particles from a full pool", () => {
  const pool = field(2);
  pool.emit({ x: 1, y: 2, z: 3, life: 1.5, age: 0.25, color: 0xff8800 });
  pool.emit({ x: 3, y: 2, z: 1, life: 1.5, age: 0.5, color: 0xffcc00 });
  pool.update(0);
  const visible = snapshot(pool);
  const cursor = pool.cursor;
  for (let i = 0; i < 100; i++) {
    pool.emit({ x: 8, y: 8, z: 0, life: 0.5, age: 0.5 + i * 0.01 });
    pool.emit({ x: -8, y: -8, z: 0, life: 0 });
  }
  pool.update(0);
  assert.equal(pool.cursor, cursor);
  assert.deepEqual(snapshot(pool), visible);
  assert.ok(Array.from(pool.size.array).every(size => size > 0));
});
