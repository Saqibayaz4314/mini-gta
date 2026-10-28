import assert from "node:assert/strict";
import { before, test } from "node:test";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  CAR,
  NITRO,
  PHYSICS_STEP,
  createCarController,
  createWalkingController,
  findSafeExit,
  headingFromRotation,
  stepCar,
  cameraClearance,
  findVehicleRecovery,
  hasVehicleAccess,
} from "../src/physics.js";
import { TERRAIN_REGIONS, buildRegionTerrain } from "../src/world.js";

before(async () => {
  await RAPIER.init();
});

function createWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_STEP;
  world.numSolverIterations = 6;
  // Match the game's bounded, two-triangle city floor.
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(1, 1, new Float32Array(4), {
      x: 224,
      y: 1,
      z: 224,
    }).setFriction(0.95),
  );
  return world;
}

function withCar(check) {
  const world = createWorld();
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .setLinearDamping(0.12)
      .setAngularDamping(0.6)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.88, 0.25, 1.85)
      .setMass(CAR.mass)
      .setFriction(0.3),
    body,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.72, 0.3, 0.95)
      .setTranslation(0, 0.54, -0.15)
      .setMass(0),
    body,
  );
  const vehicle = createCarController(world, body);
  const run = (steps, input) => {
    let telemetry;
    for (let i = 0; i < steps; i++) {
      telemetry = stepCar(
        vehicle,
        body,
        input,
        PHYSICS_STEP,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      world.step();
    }
    return telemetry;
  };
  try {
    check({ world, body, vehicle, run });
  } finally {
    world.free();
  }
}

test("four-wheel suspension supports a 1100 kg chassis without sinking or exploding", () => {
  withCar(({ body, run }) => {
    const telemetry = run(1200, { parked: true });
    assert.equal(telemetry.contacts, 4);
    assert.ok(body.translation().y > 0.5 && body.translation().y < 0.85);
    assert.ok(Math.abs(body.linvel().y) < 0.6);
    assert.ok(Math.hypot(body.translation().x, body.translation().z) < 0.1);
  });
});

test("engine accelerates, service brakes stop, and reverse engages after braking", () => {
  withCar(({ body, run }) => {
    run(180, { parked: true });
    const forward = run(300, { throttle: 1 });
    assert.ok(forward.speed > 12 && forward.speed < CAR.maxSpeed);
    assert.ok(body.translation().z > 30);
    run(180, { brake: true });
    assert.ok(Math.hypot(body.linvel().x, body.linvel().z) < 0.5);
    const reverse = run(150, { throttle: -1 });
    assert.ok(reverse.speed < -3 && reverse.speed > -CAR.reverseSpeed);
  });
});

test("steering turns through physical tyre impulses while keeping the chassis upright", () => {
  withCar(({ body, run }) => {
    run(120, { parked: true });
    run(200, { throttle: 1 });
    const telemetry = run(100, { throttle: 1, steer: 1 });
    assert.ok(headingFromRotation(body.rotation()) > 0.4);
    assert.ok(body.translation().x > 3);
    const q = body.rotation();
    assert.ok(1 - 2 * (q.x ** 2 + q.z ** 2) > 0.75);
    assert.ok(telemetry.steer < 0.48, "steering lock reduces at speed");
  });
});

test("airborne tyres cannot accelerate or steer a vehicle without ground contact", () => {
  withCar(({ body, run }) => {
    body.setTranslation({ x: 0, y: 12, z: 0 }, true);
    const telemetry = run(20, { throttle: 1, steer: 1 });
    assert.equal(telemetry.contacts, 0);
    assert.ok(Math.hypot(body.linvel().x, body.linvel().z) < 0.01);
    assert.ok(Math.abs(headingFromRotation(body.rotation())) < 0.01);
  });
});

test("nitro accelerates through tyre forces, consumes fuel, and stays bounded", () => {
  let normalSpeed;
  withCar(({ run }) => {
    run(120, { parked: true });
    normalSpeed = run(90, { throttle: 1 }).speed;
  });
  withCar(({ body, run }) => {
    run(120, { parked: true });
    const boost = run(90, { throttle: 1, boost: true });
    assert.equal(boost.boosting, true);
    assert.ok(
      boost.speed > normalSpeed * 1.25,
      `boost ${boost.speed} vs normal ${normalSpeed}`,
    );
    assert.ok(boost.speed < NITRO.maxSpeed);
    assert.ok(Math.abs(boost.nitroCharge - 0.5) < 0.02);
    const q = body.rotation();
    assert.ok(1 - 2 * (q.x ** 2 + q.z ** 2) > 0.75);
  });
});

test("empty nitro locks until recharge and brakes immediately cancel the boost", () => {
  withCar(({ run }) => {
    run(120, { parked: true });
    const empty = run(Math.round(NITRO.duration / PHYSICS_STEP), {
      throttle: 1,
      boost: true,
    });
    assert.ok(empty.nitroCharge < 0.01);
    const cooling = run(30, { throttle: 1, boost: true });
    assert.equal(cooling.boosting, false);
    assert.ok(cooling.nitroCharge > 0);
    const recharged = run(Math.ceil(NITRO.recharge / PHYSICS_STEP), {
      brake: true,
      boost: true,
    });
    assert.equal(recharged.nitroCharge, 1);
    assert.equal(recharged.boosting, false);
    const restarted = run(30, { throttle: 1, boost: true });
    assert.equal(restarted.boosting, true);
    const braked = run(1, { throttle: 1, boost: true, brake: true });
    assert.equal(braked.boosting, false);
  });
});

test("nitro cannot thrust in the air, reverse, handbrake or parked modes", () => {
  withCar(({ body, run }) => {
    run(120, { parked: true });
    for (const input of [
      { throttle: -1 },
      { throttle: 1, handbrake: true },
      { throttle: 1, parked: true },
    ]) {
      const result = run(1, { ...input, boost: true });
      assert.equal(result.boosting, false);
      assert.equal(result.nitroCharge, 1);
    }
    body.setTranslation({ x: 0, y: 20, z: 0 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(1, { throttle: 0 });
    const airborne = run(15, { throttle: 1, boost: true });
    assert.equal(airborne.contacts, 0);
    assert.equal(airborne.boosting, false);
    assert.equal(airborne.nitroCharge, 1);
    assert.ok(Math.hypot(body.linvel().x, body.linvel().z) < 0.01);
  });
});

test("a vehicle collides with a static wall instead of tunnelling through it", () => {
  withCar(({ world, body, run }) => {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(40, 4, 0.5).setTranslation(0, 4, 20),
    );
    run(120, { parked: true });
    run(600, { throttle: 1 });
    assert.ok(body.translation().z < 18);
    assert.ok(Number.isFinite(body.translation().y));
  });
});

test("taking over a moving vehicle preserves its momentum until a physical brake acts", () => {
  withCar(({ body, run }) => {
    run(120, { parked: true });
    run(150, { throttle: 1 });
    const before = body.translation().z;
    run(30, { throttle: 0, steer: 0 });
    assert.ok(body.translation().z > before + 2);
    assert.ok(body.linvel().z > 3);
  });
});

test("safe exit rejects speed and blocked doors, but accepts free ground beside a parked car", () => {
  withCar(({ world, body, run }) => {
    run(180, { parked: true });
    const safe = findSafeExit(world, RAPIER, body);
    assert.ok(safe && Math.abs(safe.x) >= 1.9);
    assert.ok(safe.y > 0.8 && safe.y < 1);
    body.setLinvel({ x: 0, y: 0, z: 3 }, true);
    assert.equal(findSafeExit(world, RAPIER, body), null);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (const side of [-1, 1]) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.6, 3, 4).setTranslation(side * 2, 3, 0),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(4, 3, 0.6).setTranslation(0, 3, side * 3.3),
      );
    }
    world.step();
    assert.equal(findSafeExit(world, RAPIER, body), null);
  });
});

test("walking capsule climbs a sidewalk curb and stops against a building wall", () => {
  const world = createWorld();
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.85, -3),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(0.5, 0.3),
    body,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(2, 0.08, 1).setTranslation(0, 0.08, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 3, 0.4).setTranslation(0, 3, 3),
  );
  const controller = createWalkingController(world);
  let peak = 0;
  try {
    world.step();
    for (let i = 0; i < 180; i++) {
      const p = body.translation();
      controller.computeColliderMovement(collider, { x: 0, y: -0.05, z: 0.06 });
      const m = controller.computedMovement();
      body.setNextKinematicTranslation({
        x: p.x + m.x,
        y: p.y + m.y,
        z: p.z + m.z,
      });
      world.step();
      peak = Math.max(peak, body.translation().y);
    }
    assert.ok(peak > 0.96, "capsule steps up onto the raised sidewalk");
    assert.ok(
      body.translation().z > 2 && body.translation().z < 2.35,
      "wall blocks further movement",
    );
    assert.ok(controller.computedGrounded());
  } finally {
    world.free();
  }
});

test("wilderness heightfields support falling bodies everywhere in every biome", () => {
  for (const region of TERRAIN_REGIONS) {
    const terrain = buildRegionTerrain(region);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = PHYSICS_STEP;
    // Mirror Terrain.jsx: rapier3d-compat takes cell counts, x-major heights
    // and a TOTAL-extent scale; the collider is centered on the region.
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(region.res, region.res, terrain.heights, {
        x: region.x1 - region.x0,
        y: 1,
        z: region.z1 - region.z0,
      }).setTranslation(
        (region.x0 + region.x1) / 2,
        0,
        (region.z0 + region.z1) / 2,
      ),
    );
    // Center plus both far corners — a mis-sized heightfield drops bodies
    // straight through the corners.
    const spots = [
      [(region.x0 + region.x1) / 2, (region.z0 + region.z1) / 2],
      [region.x0 + 4, region.z0 + 4],
      [region.x1 - 4, region.z1 - 4],
    ];
    for (const [x, z] of spots) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, terrain.heightAt(x, z) + 6, z)
          .setLinearDamping(0.2)
          .setAngularDamping(0.9),
      );
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
      let minY = Infinity;
      for (let i = 0; i < 180; i++) {
        world.step();
        minY = Math.min(minY, body.translation().y);
      }
      assert.ok(
        minY > -1,
        `${region.id} ball at (${x}, ${z}) sank to ${minY.toFixed(2)}`,
      );
      world.removeRigidBody(body);
    }
    world.free();
  }
});

test("throttle ramps in rather than applying full engine force in one step", () => {
  withCar(({ vehicle, run }) => {
    run(120, { parked: true });
    run(1, { throttle: 1 });
    const initial = Math.abs(vehicle.wheelEngineForce(2));
    assert.ok(initial > 0 && initial < CAR.engineForce * 0.2);
    run(30, { throttle: 1 });
    assert.ok(Math.abs(vehicle.wheelEngineForce(2)) > initial * 4);
  });
});

test("rear tyre grip returns progressively after releasing the handbrake", () => {
  withCar(({ vehicle, run }) => {
    run(60, { handbrake: true });
    const released = vehicle.wheelFrictionSlip(2);
    run(1, {});
    const first = vehicle.wheelFrictionSlip(2);
    assert.ok(first > released && first < 2);
    run(120, {});
    assert.ok(vehicle.wheelFrictionSlip(2) > 2.49);
  });
});

test("a nearby car cannot be entered through a wall", () => {
  withCar(({ world, body, run }) => {
    run(120, { parked: true });
    const player = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(2.4, 0.9, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3), player);
    world.step();
    assert.equal(hasVehicleAccess(world, RAPIER, player, body), true);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 2, 3).setTranslation(1.3, 2, 0),
    );
    world.step();
    assert.equal(hasVehicleAccess(world, RAPIER, player, body), false);
  });
});

test("recovery skips a road position occupied by another car", () => {
  withCar(({ world, body, run }) => {
    run(120, { parked: true });
    const origin = { x: 10, y: 1.05, z: 0 };
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 0.5, 2).setTranslation(10, 1, 0),
    );
    world.step();
    const recovery = findVehicleRecovery(world, RAPIER, body, origin);
    assert.ok(recovery && recovery.z !== 0);
    assert.equal(recovery.x, 10);
  });
});

test("camera sphere retracts before a wall and keeps clearance for its near plane", () => {
  const world = createWorld();
  try {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 4, 0.2).setTranslation(0, 4, 3),
    );
    world.step();
    const resolved = cameraClearance(
      world,
      RAPIER,
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 2, z: 8 },
    );
    assert.ok(resolved.z > 2 && resolved.z < 2.6);
    assert.equal(resolved.y, 2);
    const clear = cameraClearance(
      world,
      RAPIER,
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 2, z: -8 },
    );
    assert.deepEqual(clear, { x: 0, y: 2, z: -8 });
  } finally {
    world.free();
  }
});

test("walking stays above the full-sized city floor across its triangle seam", () => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(1, 1, new Float32Array(4), {
        x: 224,
        y: 1,
        z: 224,
      }),
    );
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        -3,
        0.85,
        -3,
      ),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.3),
      body,
    );
    const controller = createWalkingController(world);
    world.step();
    for (let i = 0; i < 120; i++) {
      const p = body.translation();
      controller.computeColliderMovement(collider, {
        x: 0.05,
        y: -0.01,
        z: 0.05,
      });
      const movement = controller.computedMovement();
      body.setNextKinematicTranslation({
        x: p.x + movement.x,
        y: p.y + movement.y,
        z: p.z + movement.z,
      });
      world.step();
      assert.ok(body.translation().y > 0.7);
    }
    assert.ok(body.translation().x > 2.5 && body.translation().z > 2.5);
  } finally {
    world.free();
  }
});

test("a rear-door fallback stays close enough to re-enter the same car", () => {
  withCar(({ world, body, run }) => {
    run(120, { parked: true });
    for (const side of [-1, 1])
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 3, 1).setTranslation(side * 2, 3, 0),
      );
    world.step();
    const exit = findSafeExit(world, RAPIER, body);
    assert.ok(exit && exit.z < -2);
    const p = body.translation();
    assert.ok(Math.hypot(exit.x - p.x, exit.y - p.y, exit.z - p.z) < 3);
  });
});
