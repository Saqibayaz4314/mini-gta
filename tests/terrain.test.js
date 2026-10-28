import assert from "node:assert/strict";
import { before, test } from "node:test";
import R from "@dimforge/rapier3d-compat";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { CITY_LIMIT, WORLD_LIMIT } from "../src/world.js";
import {
  WORLD_FLOOR,
  WORLD_BOUNDARY_COLLIDERS,
  createDistantScenery,
  createTerrainGeometry,
  getTerrainSurfaces,
  hasLostTerrainSupport,
  terrainHeightAt,
} from "../src/terrain.js";
import {
  CAR,
  PHYSICS_STEP,
  createCarController,
  createWalkingController,
  findCharacterRecovery,
  findVehicleRecovery,
  stepCar,
} from "../src/physics.js";

before(async () => {
  await R.init();
});

function terrainWorld() {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_STEP;
  world.numSolverIterations = 6;
  world.createCollider(
    R.ColliderDesc.heightfield(
      1,
      1,
      WORLD_FLOOR.heights,
      WORLD_FLOOR.scale,
    ).setTranslation(...WORLD_FLOOR.position),
  );
  world.createCollider(
    R.ColliderDesc.heightfield(1, 1, new Float32Array(4), {
      x: CITY_LIMIT * 2,
      y: 1,
      z: CITY_LIMIT * 2,
    }),
  );
  for (const terrain of getTerrainSurfaces()) {
    const r = terrain.region;
    const geometry = createTerrainGeometry(terrain);
    world.createCollider(
      R.ColliderDesc.trimesh(
        geometry.attributes.position.array,
        geometry.index.array,
        R.TriMeshFlags.FIX_INTERNAL_EDGES,
      )
        .setTranslation((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2)
        .setFriction(0.95),
    );
    geometry.dispose();
  }
  for (const wall of WORLD_BOUNDARY_COLLIDERS)
    world.createCollider(
      R.ColliderDesc.cuboid(...wall.args).setTranslation(...wall.position),
    );
  world.step();
  return world;
}

function rayHeight(world, x, z) {
  const hit = world.castRay(
    new R.Ray({ x, y: 128, z }, { x: 0, y: -1, z: 0 }),
    160,
    true,
  );
  return hit ? 128 - hit.timeOfImpact : null;
}

function createCar(world, x, z, heading = 0) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(x, terrainHeightAt(x, z) + 1.5, z)
      .setRotation({
        x: 0,
        y: Math.sin(heading / 2),
        z: 0,
        w: Math.cos(heading / 2),
      })
      .setCcdEnabled(true)
      .setLinearDamping(0.12)
      .setAngularDamping(0.6),
  );
  world.createCollider(
    R.ColliderDesc.cuboid(0.88, 0.25, 1.85).setMass(CAR.mass).setFriction(0.3),
    body,
  );
  world.createCollider(
    R.ColliderDesc.cuboid(0.72, 0.3, 0.95)
      .setTranslation(0, 0.54, -0.15)
      .setMass(0),
    body,
  );
  return { body, controller: createCarController(world, body) };
}

test("the complete playable world has ground, including biome seams and gate margins", () => {
  const world = terrainWorld();
  try {
    for (let x = -298; x <= 298; x += 11)
      for (let z = -298; z <= 298; z += 11) {
        const h = rayHeight(world, x, z);
        assert.notEqual(h, null, `missing ground at ${x},${z}`);
        assert.ok(
          Math.abs(h - terrainHeightAt(x, z)) < 0.002,
          `height mismatch at ${x},${z}`,
        );
      }
  } finally {
    world.free();
  }
});

test("visible hill triangles, collision rays and prop height sampling agree between grid vertices", () => {
  for (const terrain of getTerrainSurfaces()) {
    const r = terrain.region,
      world = new R.World({ x: 0, y: -9.81, z: 0 });
    const geometry = createTerrainGeometry(terrain),
      material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material),
      raycaster = new Raycaster();
    mesh.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    mesh.updateMatrixWorld(true);
    world.createCollider(
      R.ColliderDesc.trimesh(
        geometry.attributes.position.array,
        geometry.index.array,
        R.TriMeshFlags.FIX_INTERNAL_EDGES,
      ).setTranslation(mesh.position.x, 0, mesh.position.z),
    );
    world.step();
    try {
      for (let ix = 1; ix < terrain.nx - 1; ix += 5)
        for (let iz = 1; iz < terrain.nz - 1; iz += 5) {
          const x = r.x0 + ((ix + 0.23) * (r.x1 - r.x0)) / terrain.nx;
          const z = r.z0 + ((iz + 0.67) * (r.z1 - r.z0)) / terrain.nz;
          raycaster.set(new Vector3(x, 128, z), new Vector3(0, -1, 0));
          const visual = raycaster.intersectObject(mesh)[0],
            physical = rayHeight(world, x, z);
          assert.ok(
            visual && physical != null,
            `${r.id}: missing surface at ${x},${z}`,
          );
          assert.ok(
            Math.abs(visual.point.y - physical) < 0.002,
            `${r.id}: car would fall through the visible hill`,
          );
          assert.ok(
            Math.abs(terrain.heightAt(x, z) - physical) < 0.002,
            `${r.id}: props or recovery float above the hill`,
          );
        }
    } finally {
      world.free();
      geometry.dispose();
      material.dispose();
    }
  }
});

test("biome borders join without hidden height cliffs", () => {
  for (const z of [-260, -170, -50, 70, 180, 270])
    assert.ok(
      Math.abs(terrainHeightAt(-118.001, z) - terrainHeightAt(-117.999, z)) <
        0.02,
    );
  for (const x of [150, 190, 250, 280])
    assert.ok(
      Math.abs(terrainHeightAt(x, -28.001) - terrainHeightAt(x, -27.999)) <
        0.02,
    );
});

test("walking capsules cross mountain, mesa and city-gate seams without sinking", () => {
  for (const route of [
    { x: -122, z: -180, dx: 1, dz: 0 },
    { x: -122, z: 150, dx: 1, dz: 0 },
    { x: 230, z: -32, dx: 0, dz: 1 },
    { x: -116, z: 0, dx: 1, dz: 0 },
  ]) {
    const world = terrainWorld();
    try {
      const body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(
          route.x,
          terrainHeightAt(route.x, route.z) + 0.85,
          route.z,
        ),
      );
      const collider = world.createCollider(
          R.ColliderDesc.capsule(0.5, 0.3),
          body,
        ),
        character = createWalkingController(world);
      let vertical = 0;
      world.step();
      for (let step = 0; step < 180; step++) {
        const p = body.translation();
        vertical =
          character.computedGrounded() && vertical < 0
            ? -0.5
            : Math.max(-25, vertical - 18 * PHYSICS_STEP);
        character.computeColliderMovement(collider, {
          x: route.dx * 3.6 * PHYSICS_STEP,
          y: vertical * PHYSICS_STEP,
          z: route.dz * 3.6 * PHYSICS_STEP,
        });
        const m = character.computedMovement();
        body.setNextKinematicTranslation({
          x: p.x + m.x,
          y: p.y + m.y,
          z: p.z + m.z,
        });
        world.step();
        const next = body.translation();
        assert.ok(
          next.y > terrainHeightAt(next.x, next.z) + 0.4,
          `capsule sank at ${next.x},${next.z}`,
        );
      }
      const p = body.translation();
      assert.ok(
        (p.x - route.x) * route.dx + (p.z - route.z) * route.dz > 9,
        "capsule snagged on a terrain seam",
      );
    } finally {
      world.free();
    }
  }
});

test("physical cars stay above green hills and the mesa during off-road driving", () => {
  for (const start of [
    [-220, 110],
    [-185, 175],
    [-65, -230],
    [230, -130],
  ]) {
    const world = terrainWorld();
    try {
      const { body, controller } = createCar(world, ...start);
      for (let i = 0; i < 600; i++) {
        stepCar(
          controller,
          body,
          i < 90 ? { parked: true } : { throttle: 0.6 },
          PHYSICS_STEP,
          R.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        world.step();
        const p = body.translation(),
          h = terrainHeightAt(p.x, p.z);
        assert.ok(
          h != null && p.y > h - 0.3,
          `car sank below a hill at ${p.x},${p.z}`,
        );
      }
    } finally {
      world.free();
    }
  }
});

test("elevated actors cannot escape over the old sea-level world boundary", () => {
  const world = terrainWorld();
  try {
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(-190, 40, -296)
        .setLinvel(0, 0, -25)
        .setCcdEnabled(true),
    );
    world.createCollider(R.ColliderDesc.ball(0.5), body);
    for (let i = 0; i < 120; i++) {
      world.step();
      assert.ok(
        body.translation().z > -WORLD_LIMIT,
        "actor crossed the terrain boundary",
      );
    }
  } finally {
    world.free();
  }
});

test("decorative mountain footprints are completely outside the square playable world", () => {
  for (const scenery of createDistantScenery())
    assert.ok(
      Math.abs(scenery.position[0]) - scenery.size > WORLD_LIMIT ||
        Math.abs(scenery.position[2]) - scenery.size > WORLD_LIMIT,
    );
});

test("lost support is detected relative to hill height, even above sea level", () => {
  let point;
  for (let x = -260; x < -150 && !point; x += 10)
    for (let z = 70; z < 220; z += 10) {
      const height = terrainHeightAt(x, z);
      if (height > 8) {
        point = { x, y: height, z };
        break;
      }
    }
  assert.ok(point);
  assert.equal(hasLostTerrainSupport({ ...point, y: point.y - 3 }), true);
  assert.equal(hasLostTerrainSupport({ ...point, y: point.y + 0.85 }), false);
  assert.equal(
    hasLostTerrainSupport({ x: WORLD_LIMIT + 2, y: 30, z: 0 }),
    true,
  );
});

test("car and character recovery stay in the wilderness instead of clamping back to city coordinates", () => {
  const world = terrainWorld();
  try {
    const origin = { x: -220, y: terrainHeightAt(-220, 145) + 0.85, z: 145 };
    const { body } = createCar(world, origin.x, origin.z);
    world.step();
    const car = findVehicleRecovery(world, R, body, origin);
    const person = findCharacterRecovery(world, R, body, {
      ...origin,
      x: origin.x + 5,
    });
    assert.ok(car && person, "no safe recovery near valid hills");
    for (const p of [car, person]) {
      assert.ok(p.x < -CITY_LIMIT && p.z > CITY_LIMIT);
      assert.ok(Math.hypot(p.x - origin.x, p.z - origin.z) < 30);
      assert.ok(p.y > terrainHeightAt(p.x, p.z));
    }
  } finally {
    world.free();
  }
});
