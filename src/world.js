export const ROAD_CENTERS = [-90, -60, -30, 0, 30, 60, 90];
export const CITY_LIMIT = 112;
// Outer playable boundary — the city, desert, mountains and mesa all live inside it.
export const WORLD_LIMIT = 300;

export function random(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const rng = random(412);

// 6×6 grid of city blocks (36 total vs 16 before)
const BLOCK_COORDS = [-75, -45, -15, 15, 45, 75];
export const BLOCKS = BLOCK_COORDS.flatMap((x) =>
  BLOCK_COORDS.map((z) => ({
    x,
    z,
    park:
      (x === 15 && z === 15) ||
      (x === -45 && z === -15) ||
      (x === 60 && z === -75) ||
      (x === -75 && z === 60) ||
      (x === 45 && z === 75) ||
      (x === -15 && z === -75),
  })),
);

export const BUILDINGS = BLOCKS.filter((block) => !block.park).flatMap(
  (block) =>
    [-5.1, 5.1].flatMap((x) =>
      [-5.1, 5.1].map((z) => ({
        x: block.x + x,
        z: block.z + z,
        height: 5 + Math.floor(rng() * 22),
        width: 6.5 + rng(),
        depth: 6.5 + rng(),
        style: Math.floor(rng() * 4),
      })),
    ),
);

// Traffic colors
const COLORS_N = [
  "#65b7ae",
  "#cf6c52",
  "#c7d0d2",
  "#e8a85a",
  "#7db3c8",
  "#d4a8c4",
  "#8abeac",
];
const COLORS_S = [
  "#a8b8d1",
  "#dfc298",
  "#748b7d",
  "#d1c4a8",
  "#92aec2",
  "#c4b8d8",
  "#9ab8a4",
];
const CROSS_COLORS_E = [
  "#e4aab2",
  "#8ec5c0",
  "#d4b896",
  "#a0b8d4",
  "#c9a8d4",
  "#b4c8a0",
  "#d4b0a0",
];
const CROSS_COLORS_W = [
  "#f1e6ce",
  "#c6e0c6",
  "#e8c4a0",
  "#b8cce4",
  "#d4c0e4",
  "#c8e0b8",
  "#e0c8b8",
];

const TRAFFIC_SEEDS = [
  {
    id: "parked-coupe",
    position: [2.5, 0.85, 8],
    heading: Math.PI,
    color: "#efb346",
    isTraffic: false,
    name: "SUNSET GT",
  },
  // North-South traffic (7 roads × 2 lanes = 14)
  ...[-90, -60, -30, 0, 30, 60, 90].flatMap((road, i) => [
    {
      id: `north-${i}`,
      position: [road + 2.3, 0.85, -65 + i * 22],
      heading: Math.PI,
      color: COLORS_N[i],
      isTraffic: true,
      axis: "z",
      lane: road + 2.3,
      name: "CITY SEDAN",
    },
    {
      id: `south-${i}`,
      position: [road - 2.3, 0.85, 60 - i * 20],
      heading: 0,
      color: COLORS_S[i],
      isTraffic: true,
      axis: "z",
      lane: road - 2.3,
      name: "CITY SEDAN",
    },
  ]),
  // East-West traffic (7 roads × 2 directions = 14)
  ...[-90, -60, -30, 0, 30, 60, 90].flatMap((road, i) => [
    {
      id: `east-${i}`,
      position: [-65 + i * 22, 0.85, road + 2.3],
      heading: Math.PI / 2,
      color: CROSS_COLORS_E[i],
      isTraffic: true,
      axis: "x",
      lane: road + 2.3,
      name: "CITY SEDAN",
    },
    {
      id: `west-${i}`,
      position: [60 - i * 20, 0.85, road - 2.3],
      heading: -Math.PI / 2,
      color: CROSS_COLORS_W[i],
      isTraffic: true,
      axis: "x",
      lane: road - 2.3,
      name: "CITY SEDAN",
    },
  ]),
];

// Keep initial cars out of each other's physical footprints, including the
// parked coupe. Route staggering stays deterministic and requires no AI.
export const TRAFFIC = TRAFFIC_SEEDS.reduce((placed, seed) => {
  const car = { ...seed, position: [...seed.position] };
  const half = (entry) => (entry.axis === "x" ? [2.25, 1.25] : [1.25, 2.25]);
  if (car.isTraffic) {
    const along = car.axis === "x" ? 0 : 2;
    for (let attempt = 0; attempt < 80; attempt++) {
      const [hx, hz] = half(car);
      const overlaps = placed.some((other) => {
        const [ox, oz] = half(other);
        return (
          Math.abs(car.position[0] - other.position[0]) < hx + ox &&
          Math.abs(car.position[2] - other.position[2]) < hz + oz
        );
      });
      if (!overlaps) break;
      car.position[along] = ((car.position[along] + 17 + 95) % 190) - 95;
    }
  }
  placed.push(car);
  return placed;
}, []);

export const CHECKPOINTS = [
  { x: 2.3, z: -52, name: "THE BOULEVARD" },
  { x: 32.3, z: -60, name: "MARKET STREET" },
  { x: 90, z: 2.3, name: "EAST HARBOUR" },
  { x: 62.3, z: 62.3, name: "GARDEN DISTRICT" },
  { x: -2.3, z: 88, name: "SOUTH LOOP" },
  { x: -62.3, z: 3, name: "OLD TOWN" },
  { x: -90, z: -62, name: "NORTHWEST DOCKS" },
  { x: 2.3, z: -90, name: "UPTOWN" },
  { x: 88, z: -88, name: "EAST POINT" },
  // Wilderness circuit — highway gates lead out of the city into the biomes
  { x: 0, z: 200, name: "SOUTH HIGHWAY", region: "desert" },
  { x: 159.5, z: 2.3, name: "OASIS FLATS", region: "desert" },
  { x: 160, z: -28, name: "RED MESA", region: "mesa" },
  { x: -160, z: -168, name: "MOUNTAIN PASS", region: "mountains" },
  { x: -198, z: 2.3, name: "PINE VALLEY", region: "mountains" },
  { x: 0, z: -200, name: "NORTH RIDGE", region: "highlands" },
];

export function nearestRoadPosition(position) {
  const road = ROAD_CENTERS.reduce(
    (best, x) =>
      Math.abs(position.x - x) < Math.abs(position.x - best) ? x : best,
    0,
  );
  return {
    x: road + 2.3,
    y: 1.05,
    z: Math.max(-105, Math.min(105, position.z)),
  };
}

// ─── Wilderness biomes ──────────────────────────────────────────────────────
// Four heightfield regions surround the walled city. Each region is generated
// once from a seeded noise field; the same grid feeds the render mesh, the
// Rapier heightfield collider and prop placement, so visuals and physics match.

const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const rng = random(seed);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const value = (ix, iz) => perm[(perm[ix & 255] + (iz & 255)) & 255] / 255;
  return (x, z) => {
    const x0 = Math.floor(x),
      z0 = Math.floor(z);
    const tx = x - x0,
      tz = z - z0;
    const a = value(x0, z0),
      b = value(x0 + 1, z0);
    const c = value(x0, z0 + 1),
      d = value(x0 + 1, z0 + 1);
    const u = tx * tx * (3 - 2 * tx),
      v = tz * tz * (3 - 2 * tz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const fbm = (noise, x, z, octaves = 4) => {
  let total = 0,
    amplitude = 1,
    frequency = 1,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return total / norm;
};

export const TERRAIN_REGIONS = [
  {
    id: "mountains",
    name: "EMBER PEAKS",
    x0: -300,
    x1: -118,
    z0: -300,
    z1: 300,
    res: 58,
    amplitude: 54,
    noiseScale: 0.028,
    seed: 91,
    features: [
      // Highway pass north of the city — carved flat where the road runs so
      // the road meshes never clip through the heightfield.
      {
        kind: "pass",
        cx: -160,
        halfWidth: 20,
        strength: 1,
        z0: -300,
        z1: -118,
      },
    ],
    colors: ["#5f7d5c", "#53704f", "#7b8474", "#9aa298", "#eef2f0"],
  },
  {
    id: "desert",
    name: "ARAVERA SANDS",
    // Starts at the city wall's west edge so no ground holes open beside the gates.
    x0: -118,
    x1: 300,
    z0: -28,
    z1: 300,
    res: 44,
    amplitude: 4.5,
    noiseScale: 0.02,
    seed: 233,
    features: [],
    colors: ["#dfc18a", "#d4b177", "#c9a268"],
  },
  {
    id: "mesa",
    name: "RED MESA",
    x0: 0,
    x1: 300,
    z0: -300,
    z1: -28,
    res: 44,
    amplitude: 5,
    noiseScale: 0.022,
    seed: 407,
    features: [
      // Flat-topped table mountain — the wilderness landmark.
      {
        kind: "mesa",
        cx: 160,
        cz: -95,
        rx: 62,
        rz: 54,
        height: 26,
        hardness: 0.82,
      },
    ],
    colors: ["#c89268", "#b87a52", "#a86640", "#985838"],
  },
  {
    id: "highlands",
    name: "NORTH RIDGE",
    // Reaches the mesa/desert seam so no ground holes open beside the gates.
    // Stops at x=0 — the mesa owns everything east of the north highway, so
    // the two heightfields never overlap (overlaps z-fight between surfaces).
    x0: -118,
    x1: 0,
    z0: -300,
    z1: -28,
    res: 40,
    amplitude: 14,
    noiseScale: 0.024,
    seed: 521,
    features: [],
    colors: ["#79866a", "#6f7d60", "#8a9478", "#a8a894", "#e8ece8"],
  },
];

export const MESA_LANDMARK = Object.freeze({
  x: 160,
  z: -95,
  radius: 62,
  height: 28,
});

// Flat corridors carved through every region so highways stay drivable.
export const HIGHWAY_CORRIDORS = [
  { axis: "x", at: 0, halfWidth: 15 }, // north highway (z < -112)
  { axis: "z", at: 0, halfWidth: 15 }, // east / west highway
];

const regionHeight = (region, x, z, noise) => {
  const nx = x * region.noiseScale;
  const nz = z * region.noiseScale;
  let h = (fbm(noise, nx, nz) - 0.42) * region.amplitude;
  if (region.id === "mountains") {
    h +=
      smooth(0.25, 1, fbm(noise, nx * 0.55 + 40, nz * 0.55 - 25)) *
      region.amplitude *
      0.9;
    h = Math.max(h, 0);
  } else if (region.id === "mesa") {
    h = Math.max(h, 0) * 0.4;
    const d = Math.max(Math.abs(x - 160) / 62, Math.abs(z + 95) / 54);
    const plateau = smooth(1.15, 0.78, d) * 26;
    const bumps =
      fbm(noise, nx * 3 + 11, nz * 3 + 7) * 2.2 * Math.min(1, plateau / 6);
    h += plateau + bumps;
  } else {
    h = Math.max(h, 0);
  }
  for (const feature of region.features) {
    if (feature.kind === "pass") {
      // Only carve where the road actually runs, fading out past its ends.
      const onRoad =
        smooth(feature.z0 - 14, feature.z0, z) *
        smooth(feature.z1 + 14, feature.z1, z);
      h *=
        1 -
        feature.strength *
          smooth(
            feature.halfWidth,
            feature.halfWidth * 0.3,
            Math.abs(x - feature.cx),
          ) *
          onRoad;
    }
  }
  // Flatten highway corridors (and the city-side margin of each region).
  for (const corridor of HIGHWAY_CORRIDORS) {
    const d = Math.abs(
      corridor.axis === "x" ? x - corridor.at : z - corridor.at,
    );
    h *= smooth(corridor.halfWidth, corridor.halfWidth + 26, d);
  }
  // Neighbouring heightfields have different seeds and resolutions. Bring every
  // region edge to the same level so crossing a seam cannot drop off a hidden
  // height discontinuity. The outer world perimeter gets the same gentle ramp.
  const borderDistance = Math.min(
    x - region.x0,
    region.x1 - x,
    z - region.z0,
    region.z1 - z,
  );
  h *= smooth(0, 32, borderDistance);
  // The walled city renders its own flat ground at y=0 — heightfields that
  // overlap it (desert SE, mesas E, highlands N) sink just below that plane so
  // the two surfaces never z-fight, then climb to full height outside the walls.
  const rCity = Math.max(Math.abs(x), Math.abs(z));
  const cityFade = smooth(112, 118, rCity);
  h *= cityFade;
  h -= 0.02 * (1 - cityFade);
  if (region.x0 === -300) h *= smooth(-300, -150, x);
  if (region.x1 === 300) h *= smooth(300, 150, x);
  return h;
};

// Builds the shared height grid for a region. Stored x-major as
// heights[ix * (nz + 1) + iz] (z varies fastest), which matches the
// rapier3d-compat heightfield API: nrows/ncols are cell counts, the array
// holds (nrows+1)*(ncols+1) samples and the scale is the TOTAL extent.
export function buildRegionTerrain(region) {
  const noise = makeNoise(region.seed);
  const nx = region.res;
  const nz = region.res;
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let ix = 0; ix <= nx; ix++) {
    const x = region.x0 + ((region.x1 - region.x0) * ix) / nx;
    for (let iz = 0; iz <= nz; iz++) {
      const z = region.z0 + ((region.z1 - region.z0) * iz) / nz;
      heights[ix * (nz + 1) + iz] = regionHeight(region, x, z, noise);
    }
  }
  const sx = (region.x1 - region.x0) / nx;
  const sz = (region.z1 - region.z0) / nz;
  const heightAt = (x, z) => {
    const gx = Math.min(nx - 1e-6, Math.max(0, (x - region.x0) / sx));
    const gz = Math.min(nz - 1e-6, Math.max(0, (z - region.z0) / sz));
    const i0 = Math.floor(gx),
      j0 = Math.floor(gz);
    const fx = gx - i0,
      fz = gz - j0;
    const stride = nz + 1;
    const h00 = heights[i0 * stride + j0];
    const h10 = heights[(i0 + 1) * stride + j0];
    const h01 = heights[i0 * stride + j0 + 1];
    const h11 = heights[(i0 + 1) * stride + j0 + 1];
    // Match the diagonal used by the rendered grid and Rapier heightfields.
    // Bilinear interpolation invents a curved surface between the two triangles.
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  return { region, nx, nz, heights, heightAt };
}

export function regionAt(x, z) {
  if (Math.abs(x) <= CITY_LIMIT && Math.abs(z) <= CITY_LIMIT)
    return { id: "city", name: "SUNSET DISTRICT" };
  for (const region of TERRAIN_REGIONS)
    if (x >= region.x0 && x <= region.x1 && z >= region.z0 && z <= region.z1)
      return { id: region.id, name: region.name };
  return { id: "wilds", name: "OUTLANDS" };
}
