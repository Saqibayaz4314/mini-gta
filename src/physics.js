import { WORLD_LIMIT } from "./world.js";
import { terrainHeightAt } from "./terrain.js";

// All forces are in SI units. Controllers run at the fixed physics rate, never
// at the render frame rate. Shared by the game and headless Rapier regression tests.
export const PHYSICS_STEP = 1 / 60;
export const NITRO = Object.freeze({
  duration: 3,
  recharge: 6,
  force: 2.2,
  maxSpeed: 42,
});
export const CAR = Object.freeze({
  mass: 1100,
  wheelRadius: 0.34,
  suspensionLength: 0.38,
  maxSpeed: 30,
  reverseSpeed: 9,
  engineForce: 2900,
  maxExitSpeed: 2.5,
  wheelPositions: [
    { x: -0.92, y: 0, z: 1.3 },
    { x: 0.92, y: 0, z: 1.3 },
    { x: -0.92, y: 0, z: -1.3 },
    { x: 0.92, y: 0, z: -1.3 },
  ],
});

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const angleDelta = (target, current) =>
  Math.atan2(Math.sin(target - current), Math.cos(target - current));
export const headingFromRotation = (q) =>
  Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));

const driveStates = new WeakMap();
const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

export function createCarController(world, body) {
  const vehicle = world.createVehicleController(body);
  vehicle.indexUpAxis = 1;
  vehicle.setIndexForwardAxis = 2;
  driveStates.set(vehicle, {
    throttle: 0,
    brake: 0,
    rearGrip: 2.5,
    nitro: 1,
    nitroLocked: false,
  });
  for (const [i, point] of CAR.wheelPositions.entries()) {
    vehicle.addWheel(
      point,
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      CAR.suspensionLength,
      CAR.wheelRadius,
    );
    vehicle.setWheelSuspensionStiffness(i, 32);
    vehicle.setWheelSuspensionCompression(i, 4.4);
    vehicle.setWheelSuspensionRelaxation(i, 5.2);
    vehicle.setWheelMaxSuspensionTravel(i, 0.24);
    vehicle.setWheelMaxSuspensionForce(i, 14000);
    vehicle.setWheelFrictionSlip(i, 2.5);
    vehicle.setWheelSideFrictionStiffness(i, 1);
  }
  return vehicle;
}

export function stepCar(vehicle, body, input, dt, queryFlags) {
  // Fast Refresh may preserve a live Rapier controller while reloading this
  // module's WeakMap. Initialize its input state again instead of stopping physics.
  let controls = driveStates.get(vehicle);
  if (!controls) {
    controls = {
      throttle: 0,
      brake: 0,
      rearGrip: 2.5,
      nitro: 1,
      nitroLocked: false,
    };
    driveStates.set(vehicle, controls);
  }
  const q = body.rotation();
  const heading = headingFromRotation(q);
  const velocity = body.linvel();
  const speed = velocity.x * Math.sin(heading) + velocity.z * Math.cos(heading);
  const requestedThrottle = clamp(input.throttle || 0, -1, 1);
  const reversingDirection = requestedThrottle * speed < -0.65;
  controls.throttle = damp(
    controls.throttle,
    reversingDirection || input.brake || input.parked ? 0 : requestedThrottle,
    7,
    dt,
  );
  const throttle = controls.throttle;
  // Boost still passes through the driven tyres: no thrust while airborne,
  // reversing, braking or upside down. Fuel and recharge use simulated time.
  const grounded =
    input.boost &&
    CAR.wheelPositions.reduce(
      (count, _, i) => count + Number(vehicle.wheelIsInContact(i)),
      0,
    ) >= 2;
  const boosting = Boolean(
    input.boost &&
    requestedThrottle > 0 &&
    speed >= -0.1 &&
    !input.brake &&
    !input.handbrake &&
    !input.parked &&
    grounded &&
    1 - 2 * (q.x * q.x + q.z * q.z) > 0.5 &&
    !controls.nitroLocked &&
    controls.nitro > 0,
  );
  controls.nitro = clamp(
    controls.nitro + dt * (boosting ? -1 / NITRO.duration : 1 / NITRO.recharge),
    0,
    1,
  );
  if (boosting && controls.nitro < 1e-6) {
    controls.nitro = 0;
    controls.nitroLocked = true;
  }
  if (controls.nitro >= 1) controls.nitroLocked = false;
  const limit =
    throttle < 0 ? CAR.reverseSpeed : boosting ? NITRO.maxSpeed : CAR.maxSpeed;
  const power = Math.max(0, 1 - (Math.abs(speed) / limit) ** 2);
  const force =
    reversingDirection || input.brake || input.parked
      ? 0
      : throttle * CAR.engineForce * power * (boosting ? NITRO.force : 1);
  const brakeTarget = input.parked
    ? 45
    : input.brake || reversingDirection
      ? 32
      : throttle === 0
        ? 0.18
        : 0;
  controls.brake = damp(controls.brake, brakeTarget, 14, dt);
  controls.rearGrip = damp(
    controls.rearGrip,
    input.handbrake ? 0.85 : 2.5,
    input.handbrake ? 12 : 5,
    dt,
  );
  // Reduce steering lock as speed rises. Rear grip is released by the handbrake.
  const targetSteer =
    clamp(input.steer || 0, -1, 1) *
    (0.56 / (1 + (Math.abs(speed) / 11) ** 1.4));
  const steer =
    (vehicle.wheelSteering(0) || 0) +
    (targetSteer - (vehicle.wheelSteering(0) || 0)) * (1 - Math.exp(-7 * dt));
  for (let i = 0; i < 4; i++) {
    vehicle.setWheelSteering(i, i < 2 ? steer : 0);
    vehicle.setWheelEngineForce(i, i >= 2 ? force : 0);
    vehicle.setWheelBrake(i, input.handbrake && i >= 2 ? 52 : controls.brake);
    vehicle.setWheelFrictionSlip(i, i >= 2 ? controls.rearGrip : 2.7);
  }
  vehicle.updateVehicle(dt, queryFlags);

  const contacts = CAR.wheelPositions.reduce(
    (count, _, i) => count + Number(vehicle.wheelIsInContact(i)),
    0,
  );
  if (contacts >= 2) {
    // A mild anti-roll assist applies torque; pitch and roll remain physically free.
    const upX = 2 * (q.x * q.y - q.w * q.z);
    const upZ = 2 * (q.y * q.z + q.w * q.x);
    const angular = body.angvel();
    body.applyTorqueImpulse(
      {
        x: (-upZ * 3.5 - angular.x * 0.8) * CAR.mass * dt,
        y: 0,
        z: (upX * 3.5 - angular.z * 0.8) * CAR.mass * dt,
      },
      false,
    );
  }
  const lateralSpeed =
    velocity.x * Math.cos(heading) - velocity.z * Math.sin(heading);
  return {
    speed,
    contacts,
    steer,
    throttle,
    boosting,
    nitroCharge: controls.nitro,
    braking: Boolean(input.brake || reversingDirection || input.parked),
    handbrake: Boolean(input.handbrake),
    sliding: contacts >= 2 && Math.abs(lateralSpeed) > 2.3,
  };
}

export function createWalkingController(world) {
  const controller = world.createCharacterController(0.025);
  controller.enableAutostep(0.28, 0.25, false);
  controller.enableSnapToGround(0.3);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 3);
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.setCharacterMass(75);
  return controller;
}

// Test both sides, then behind the car. Never place the capsule inside a wall,
// another car, or a low ceiling. Only exit after the car has nearly stopped.
export function findSafeExit(world, rapier, body) {
  const velocity = body.linvel();
  if (Math.hypot(velocity.x, velocity.z) > CAR.maxExitSpeed) return null;
  const p = body.translation();
  const heading = headingFromRotation(body.rotation());
  const right = { x: Math.cos(heading), z: -Math.sin(heading) };
  const forward = { x: Math.sin(heading), z: Math.cos(heading) };
  for (const [side, back] of [
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const x = p.x + right.x * side * 2 + forward.x * back * 2.7;
    const z = p.z + right.z * side * 2 + forward.z * back * 2.7;
    const ray = new rapier.Ray({ x, y: p.y + 2, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRayAndGetNormal(
      ray,
      5,
      true,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      body,
    );
    if (!hit || hit.normal.y < 0.8) continue;
    const position = { x, y: ray.origin.y - hit.timeOfImpact + 0.85, z };
    const blocked = world.intersectionWithShape(
      position,
      { x: 0, y: 0, z: 0, w: 1 },
      new rapier.Capsule(0.5, 0.33),
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      body,
    );
    if (!blocked) return position;
  }
  return null;
}

export function hasVehicleAccess(world, rapier, playerBody, vehicleBody) {
  const p = playerBody.translation(),
    car = vehicleBody.translation();
  const dx = car.x - p.x,
    dy = car.y + 0.35 - p.y,
    dz = car.z - p.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.01) return true;
  const ray = new rapier.Ray(p, {
    x: dx / distance,
    y: dy / distance,
    z: dz / distance,
  });
  return !world.castRay(
    ray,
    distance,
    true,
    rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    undefined,
    playerBody,
    (collider) => collider.parent()?.handle !== vehicleBody.handle,
  );
}

function recoveryGround(world, rapier, body, position, clearance) {
  const expected = terrainHeightAt(position.x, position.z);
  if (expected == null) return null;
  const startY = Math.max(position.y + 4, expected + clearance + 4);
  const ray = new rapier.Ray(
    { x: position.x, y: startY, z: position.z },
    { x: 0, y: -1, z: 0 },
  );
  const hit = world.castRayAndGetNormal(
    ray,
    Math.max(32, startY + 4),
    true,
    rapier.QueryFilterFlags.EXCLUDE_SENSORS |
      rapier.QueryFilterFlags.EXCLUDE_DYNAMIC |
      rapier.QueryFilterFlags.EXCLUDE_KINEMATIC,
    undefined,
    undefined,
    body,
  );
  if (!hit || hit.normal.y < 0.7) return null;
  return {
    x: position.x,
    y: startY - hit.timeOfImpact + clearance,
    z: position.z,
  };
}

export function findVehicleRecovery(world, rapier, body, origin, heading = 0) {
  const shape = new rapier.Cuboid(1.12, 0.8, 2.2);
  const rotation = {
    x: 0,
    y: Math.sin(heading / 2),
    z: 0,
    w: Math.cos(heading / 2),
  };
  const offsets = [
    [0, 0],
    [0, 6],
    [0, -6],
    [6, 0],
    [-6, 0],
    [6, 6],
    [-6, -6],
    [0, 12],
    [0, -12],
    [12, 0],
    [-12, 0],
    [0, 18],
    [0, -18],
    [0, 24],
    [0, -24],
  ];
  for (const [dx, dz] of offsets) {
    const sample = {
      x: clamp(origin.x + dx, -WORLD_LIMIT + 3, WORLD_LIMIT - 3),
      y: origin.y,
      z: clamp(origin.z + dz, -WORLD_LIMIT + 3, WORLD_LIMIT - 3),
    };
    // Do not "solve" an occupied spawn by teleporting onto the other car's roof.
    const occupied = world.intersectionWithShape(
      { ...sample, y: sample.y + 0.3 },
      rotation,
      shape,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      body,
      (collider) =>
        collider.shape.type !== rapier.ShapeType.HeightField &&
        collider.shape.type !== rapier.ShapeType.TriMesh,
    );
    if (occupied) continue;
    const candidate = recoveryGround(world, rapier, body, sample, 1.05);
    if (!candidate) continue;
    const blocked = world.intersectionWithShape(
      { ...candidate, y: candidate.y + 0.3 },
      rotation,
      shape,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      body,
    );
    if (!blocked) return candidate;
  }
  return null;
}

export function findCharacterRecovery(world, rapier, body, origin) {
  const shape = new rapier.Capsule(0.5, 0.31),
    rotation = { x: 0, y: 0, z: 0, w: 1 };
  for (const [dx, dz] of [
    [0, 0],
    [1.5, 0],
    [-1.5, 0],
    [0, 1.5],
    [0, -1.5],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
  ]) {
    const sample = {
      x: clamp(origin.x + dx, -WORLD_LIMIT + 1, WORLD_LIMIT - 1),
      y: origin.y,
      z: clamp(origin.z + dz, -WORLD_LIMIT + 1, WORLD_LIMIT - 1),
    };
    const candidate = recoveryGround(world, rapier, body, sample, 0.85);
    if (!candidate) continue;
    if (
      !world.intersectionWithShape(
        candidate,
        rotation,
        shape,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body,
      )
    )
      return candidate;
  }
  return null;
}

// A sphere protects the camera's near plane. Query the actual smoothed camera
// position too, otherwise lerping between two clear positions can cross a wall.
export function cameraClearance(world, rapier, target, desired) {
  const direction = {
    x: desired.x - target.x,
    y: desired.y - target.y,
    z: desired.z - target.z,
  };
  const distance = Math.hypot(direction.x, direction.y, direction.z);
  if (distance < 0.01) return { ...desired };
  const flags =
    rapier.QueryFilterFlags.EXCLUDE_DYNAMIC |
    rapier.QueryFilterFlags.EXCLUDE_KINEMATIC |
    rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  const hit = world.castShape(
    target,
    { x: 0, y: 0, z: 0, w: 1 },
    direction,
    new rapier.Ball(0.24),
    0.03,
    1,
    true,
    flags,
  );
  const fraction = hit
    ? Math.max(0, hit.time_of_impact ?? hit.timeOfImpact)
    : 1;
  return {
    x: target.x + direction.x * fraction,
    y: target.y + direction.y * fraction,
    z: target.z + direction.z * fraction,
  };
}
