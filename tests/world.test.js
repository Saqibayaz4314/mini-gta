import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCKS,
  BUILDINGS,
  CHECKPOINTS,
  ROAD_CENTERS,
  TERRAIN_REGIONS,
  TRAFFIC,
  WORLD_LIMIT,
  buildRegionTerrain,
  regionAt,
} from "../src/world.js";

test("buildings fit completely inside their raised sidewalk blocks", () => {
  for (const building of BUILDINGS) {
    assert.ok(
      BLOCKS.some(
        (block) =>
          !block.park &&
          Math.abs(building.x - block.x) + building.width / 2 < 9 &&
          Math.abs(building.z - block.z) + building.depth / 2 < 9,
      ),
    );
  }
});

test("traffic routes and checkpoints lie on the generated road grid", () => {
  for (const car of TRAFFIC.filter((car) => car.isTraffic)) {
    assert.ok(ROAD_CENTERS.some((road) => Math.abs(car.lane - road) < 3));
    assert.ok(car.axis === "x" || car.axis === "z");
  }
  assert.equal(new Set(TRAFFIC.map((car) => car.id)).size, TRAFFIC.length);
  // Only city checkpoints (no region) must lie on the road grid;
  // wilderness/biome checkpoints intentionally live outside city bounds.
  for (const point of CHECKPOINTS.filter((cp) => !cp.region)) {
    assert.ok(
      ROAD_CENTERS.some(
        (road) => Math.abs(point.x - road) < 3 || Math.abs(point.z - road) < 3,
      ),
    );
  }
});

test("wilderness checkpoints sit inside their biome and the world bounds", () => {
  for (const point of CHECKPOINTS.filter((cp) => cp.region)) {
    const region = TERRAIN_REGIONS.find((r) => r.id === point.region);
    assert.ok(region, `unknown region ${point.region}`);
    assert.ok(
      point.x >= region.x0 &&
        point.x <= region.x1 &&
        point.z >= region.z0 &&
        point.z <= region.z1,
      `${point.name} outside ${region.id}`,
    );
    assert.ok(
      Math.abs(point.x) <= WORLD_LIMIT && Math.abs(point.z) <= WORLD_LIMIT,
    );
  }
});

test("terrain heightfields are finite, near sea level and drivable at highways", () => {
  for (const region of TERRAIN_REGIONS) {
    const terrain = buildRegionTerrain(region);
    assert.equal(terrain.heights.length, (region.res + 1) ** 2);
    for (const h of terrain.heights) {
      // Inside the walled city the grids sink to -0.02 so they never render
      // coplanar with the city floor; everywhere else heights stay >= 0.
      assert.ok(Number.isFinite(h) && h >= -0.05 && h < 90);
    }
  }
  // The mountain pass highway stays climbable for the car controller
  const peaks = buildRegionTerrain(TERRAIN_REGIONS[0]);
  assert.ok(peaks.heightAt(-160, -168) < 12);
  // The pass floor is carved flat wherever the road runs, so the road meshes
  // can never clip through the heightfield.
  for (let z = -290; z <= -130; z += 40) {
    assert.ok(peaks.heightAt(-160, z) < 1.5, `pass floor not flat at z=${z}`);
  }
  // Away from the road the mountains keep their relief.
  assert.ok(peaks.heightAt(-160, 100) > 1, "south mountains flattened by pass");
  // Highway corridors are flat where they cross each region
  for (const region of TERRAIN_REGIONS) {
    const terrain = buildRegionTerrain(region);
    const midX = (region.x0 + region.x1) / 2;
    const midZ = (region.z0 + region.z1) / 2;
    if (region.z0 <= 0 && region.z1 >= 0)
      assert.ok(
        terrain.heightAt(midX, 0) < 1.5,
        `${region.id} blocks east-west highway`,
      );
    if (region.x0 <= 0 && region.x1 >= 0)
      assert.ok(
        terrain.heightAt(0, midZ) < 1.5,
        `${region.id} blocks north highway`,
      );
  }
});

test("height grids follow rapier3d-compat's x-major layout (z varies fastest)", () => {
  for (const region of TERRAIN_REGIONS) {
    const { heights, nx, nz, heightAt } = buildRegionTerrain(region);
    const x = (ix) => region.x0 + ((region.x1 - region.x0) * ix) / nx;
    const z = (iz) => region.z0 + ((region.z1 - region.z0) * iz) / nz;
    for (const [ix, iz] of [
      [0, 0],
      [nx, 0],
      [0, nz],
      [nx, nz],
      [7, 13],
      [22, 31],
    ]) {
      // Corner samples interpolate across the last cell (heightAt clamps just
      // inside the grid), so allow a tiny interpolation error; a wrong layout
      // would differ by tens of units and still fail.
      assert.ok(
        Math.abs(heights[ix * (nz + 1) + iz] - heightAt(x(ix), z(iz))) < 1e-3,
        `${region.id} grid (${ix}, ${iz}) out of sync`,
      );
    }
  }
});

test("every highway leaving a city gate is covered by a terrain region", () => {
  for (let d = 114; d <= 298; d += 23) {
    for (const [x, z] of [
      [0, d],
      [0, -d],
      [d, 0],
      [-d, 0],
    ]) {
      assert.notEqual(
        regionAt(x, z).id,
        "wilds",
        `ground hole at (${x}, ${z})`,
      );
    }
  }
});

test("terrain sinks below the city floor so the surfaces never z-fight", () => {
  for (const region of TERRAIN_REGIONS) {
    const terrain = buildRegionTerrain(region);
    for (const [x, z] of [
      [0, 0],
      [60, 60],
      [-60, 60],
      [60, -60],
      [-60, -60],
    ]) {
      if (x < region.x0 || x > region.x1 || z < region.z0 || z > region.z1)
        continue;
      assert.ok(
        terrain.heightAt(x, z) < -0.005,
        `${region.id} sits on the city floor plane at (${x}, ${z})`,
      );
    }
  }
});

test("heightfield regions never overlap each other", () => {
  for (const a of TERRAIN_REGIONS) {
    for (const b of TERRAIN_REGIONS) {
      if (a.id === b.id) continue;
      const overlapX = Math.max(a.x0, b.x0) < Math.min(a.x1, b.x1);
      const overlapZ = Math.max(a.z0, b.z0) < Math.min(a.z1, b.z1);
      assert.ok(
        !(overlapX && overlapZ),
        `${a.id} and ${b.id} overlap — surfaces z-fight`,
      );
    }
  }
});

test("initial traffic never spawns inside another car or the parked coupe", () => {
  const half = (car) => (car.axis === "x" ? [2.25, 1.25] : [1.25, 2.25]);
  TRAFFIC.forEach((a, i) =>
    TRAFFIC.slice(i + 1).forEach((b) => {
      const [ax, az] = half(a),
        [bx, bz] = half(b);
      assert.ok(
        Math.abs(a.position[0] - b.position[0]) >= ax + bx ||
          Math.abs(a.position[2] - b.position[2]) >= az + bz,
        `${a.id} overlaps ${b.id}`,
      );
    }),
  );
});
