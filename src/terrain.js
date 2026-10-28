import { PlaneGeometry } from "three";
import {
  CITY_LIMIT,
  TERRAIN_REGIONS,
  WORLD_LIMIT,
  buildRegionTerrain,
} from "./world.js";

export const WORLD_FLOOR_Y = -0.08;
export const WORLD_FLOOR = {
  heights: new Float32Array(4),
  scale: { x: WORLD_LIMIT * 2, y: 1, z: WORLD_LIMIT * 2 },
  position: [0, WORLD_FLOOR_Y, 0],
};

// The collision boundary must extend above every generated mountain, not just
// the sea-level road. Its visible fence is draped over the same terrain below.
export const WORLD_BOUNDARY_COLLIDERS = [-1, 1].flatMap((side) => [
  {
    type: "cuboid",
    args: [0.5, 52, WORLD_LIMIT],
    position: [side * WORLD_LIMIT, 44, 0],
  },
  {
    type: "cuboid",
    args: [WORLD_LIMIT, 52, 0.5],
    position: [0, 44, side * WORLD_LIMIT],
  },
]);

let surfaces;
export function getTerrainSurfaces() {
  if (!surfaces) surfaces = TERRAIN_REGIONS.map(buildRegionTerrain);
  return surfaces;
}

export function terrainHeightAt(x, z) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    Math.abs(x) > WORLD_LIMIT ||
    Math.abs(z) > WORLD_LIMIT
  )
    return null;
  let height = WORLD_FLOOR_Y;
  if (Math.abs(x) <= CITY_LIMIT && Math.abs(z) <= CITY_LIMIT) height = 0;
  for (const terrain of getTerrainSurfaces()) {
    const r = terrain.region;
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)
      height = Math.max(height, terrain.heightAt(x, z));
  }
  return height;
}

export function hasLostTerrainSupport(position, depth = 2) {
  const height = terrainHeightAt(position.x, position.z);
  return (
    height == null ||
    !Number.isFinite(position.y) ||
    position.y < height - depth
  );
}

// This is the actual render geometry, also used by regression raycasts. Geometry
// and collision heights come from the same cached surface instead of recreating
// subtly different terrain representations for physics, scenery and recovery.
export function createTerrainGeometry(terrain) {
  const { region, nx, nz, heights } = terrain;
  const geometry = new PlaneGeometry(
    region.x1 - region.x0,
    region.z1 - region.z0,
    nx,
    nz,
  );
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const ix = i % (nx + 1),
      iz = Math.floor(i / (nx + 1));
    positions.setY(i, heights[ix * (nz + 1) + iz]);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBoundaryFence() {
  const segments = [],
    length = 6;
  for (const side of [-1, 1])
    for (let at = -WORLD_LIMIT; at < WORLD_LIMIT; at += length) {
      const end = Math.min(WORLD_LIMIT, at + length),
        mid = (at + end) / 2;
      const edge = side * (WORLD_LIMIT - 0.55);
      const h0 = terrainHeightAt(edge, at),
        h1 = terrainHeightAt(edge, end);
      const v0 = terrainHeightAt(at, edge),
        v1 = terrainHeightAt(end, edge);
      segments.push({
        position: [side * WORLD_LIMIT, (h0 + h1) / 2 + 1.2, mid],
        rotation: [Math.atan2(h0 - h1, length), 0, 0],
        scale: [0.8, 2.4, Math.hypot(length, h1 - h0) + 0.05],
      });
      segments.push({
        position: [mid, (v0 + v1) / 2 + 1.2, side * WORLD_LIMIT],
        rotation: [0, 0, Math.atan2(v1 - v0, length)],
        scale: [Math.hypot(length, v1 - v0) + 0.05, 2.4, 0.8],
      });
    }
  return segments;
}

export function createDistantScenery() {
  return Array.from({ length: 26 }, (_, i) => {
    const angle = (i / 26) * Math.PI * 2,
      size = 34 + (i % 5) * 14;
    const x = Math.cos(angle),
      z = Math.sin(angle);
    // The playable world is square. A circular ring at radius 360 still puts
    // decorative mountains inside its corners, so clear their entire footprint.
    const distance =
      (WORLD_LIMIT + size + 24) / Math.max(Math.abs(x), Math.abs(z));
    return {
      position: [x * distance, -4, z * distance],
      scale: [1, 1, 1],
      size,
    };
  });
}
