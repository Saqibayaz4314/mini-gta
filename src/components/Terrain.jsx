import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  HeightfieldCollider,
  TrimeshCollider,
  useRapier,
  RigidBody,
} from "@react-three/rapier";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
} from "three";

import { random } from "../world.js";

import {
  WORLD_FLOOR,
  WORLD_BOUNDARY_COLLIDERS,
  createBoundaryFence,
  createDistantScenery,
  createTerrainGeometry,
  getTerrainSurfaces,
} from "../terrain.js";

// Static terrain uses the exact visible triangles for collision, including edge
// fixing for stable tyre and capsule contacts. Heights and prop placement share
// the same surface data. Decorative mountains stay outside the playable bounds.

const lerpColor = (out, a, b, t) => {
  const ca = new Color(a),
    cb = new Color(b);
  out.copy(ca).lerp(cb, t);
  return out;
};

function Instanced({
  items,
  geometry,
  material,
  castShadow = false,
  receiveShadow = false,
}) {
  const ref = useRef();
  useLayoutEffect(() => {
    if (!ref.current) return;
    const dummy = new Object3D();
    items.forEach((item, i) => {
      dummy.position.set(...item.position);
      dummy.rotation.set(...(item.rotation || [0, 0, 0]));
      dummy.scale.set(...(item.scale || [1, 1, 1]));
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
      if (item.color) ref.current.setColorAt(i, new Color(item.color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

export default function Terrain() {
  const { rapier } = useRapier();
  const data = useMemo(() => {
    const terrains = getTerrainSurfaces();
    const byId = Object.fromEntries(terrains.map((t) => [t.region.id, t]));
    const rng = random(917);

    // ── Render geometry with height-blended vertex colors ──
    const regionMeshes = terrains.map((t) => {
      const { region, heights } = t;
      const geometry = createTerrainGeometry(t);
      const position = geometry.attributes.position;
      const palette = region.colors.map((c) => new Color(c));
      let maxH = 1e-6;
      for (let i = 0; i < heights.length; i++)
        maxH = Math.max(maxH, heights[i]);
      const colors = new Float32Array(position.count * 3);
      const tmp = new Color();
      for (let i = 0; i < position.count; i++) {
        const h = position.getY(i);
        const f = Math.max(0, Math.min(1, h / maxH)) * (palette.length - 1);
        const i0 = Math.min(palette.length - 2, Math.floor(f));
        lerpColor(tmp, palette[i0], palette[i0 + 1], f - i0);
        const jitter = 0.93 + rng() * 0.14;
        colors[i * 3] = tmp.r * jitter;
        colors[i * 3 + 1] = tmp.g * jitter;
        colors[i * 3 + 2] = tmp.b * jitter;
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      return {
        id: region.id,
        geometry,
        center: [(region.x0 + region.x1) / 2, 0, (region.z0 + region.z1) / 2],
        colliderArgs: [
          geometry.attributes.position.array,
          geometry.index.array,
          rapier.TriMeshFlags.FIX_INTERNAL_EDGES,
        ],
      };
    });

    // ── Biome props ──
    const cacti = [],
      cactusArms = [],
      rocks = [],
      shrubs = [];
    const pines = [],
      pineTrunks = [],
      spires = [],
      palms = [];
    const colliders = [];

    const inOasis = (x, z) => Math.hypot(x - 150, z - 160) < 32;
    const onHighwayZ = (x) => Math.abs(x) < 17;
    const onHighwayX = (z) => Math.abs(z) < 17;

    // Desert (SE): saguaro cacti, rocks, dry shrubs on an even jittered grid.
    const desert = byId.desert;
    for (let i = 0; i < 28; i++) {
      for (let j = 0; j < 50; j++) {
        const x = 122 + i * 6.4 + rng() * 5;
        const z = -24 + j * 6.5 + rng() * 5;
        if (x > 292 || z > 292 || inOasis(x, z) || onHighwayZ(x)) continue;
        const y = desert.heightAt(x, z);
        const roll = rng();
        if (roll < 0.3) {
          const h = 1.7 + rng() * 1.9;
          const rot = rng() * Math.PI;
          cacti.push({
            position: [x, y + h / 2, z],
            scale: [0.34, h, 0.34],
            rotation: [0, rot, 0],
          });
          if (rng() < 0.75) {
            const side = rng() < 0.5 ? 1 : -1;
            const ay = y + h * (0.42 + rng() * 0.25);
            cactusArms.push({
              position: [x + side * 0.42, ay, z],
              scale: [0.55, 0.19, 0.19],
              rotation: [0, rot, 0],
            });
            cactusArms.push({
              position: [x + side * 0.62, ay + 0.34, z],
              scale: [0.17, 0.62, 0.17],
              rotation: [0, rot, 0],
            });
          }
        } else if (roll < 0.5) {
          const s = 0.5 + rng() * 1.5;
          rocks.push({
            position: [x, y + s * 0.32, z],
            scale: [s, s * 0.72, s],
            rotation: [rng(), rng() * 3, rng()],
          });
          if (s > 1.15)
            colliders.push({
              type: "ball",
              args: [s * 0.5],
              position: [x, y + s * 0.3, z],
            });
        } else if (roll < 0.68) {
          shrubs.push({
            position: [x, y + 0.16, z],
            scale: [0.55, 0.32, 0.55],
            rotation: [0, rng() * 3, 0],
          });
        }
      }
    }

    // Oasis landmark: pond, rim, leaning palms, and a desert water tower.
    palms.push({
      position: [136, desert.heightAt(136, 154) + 2.3, 154],
      scale: [1, 1, 1],
      rotation: [0.22, 0, 0.1],
    });
    palms.push({
      position: [163, desert.heightAt(163, 150) + 2.5, 150],
      scale: [1.1, 1.1, 1.1],
      rotation: [-0.2, 0, 0.18],
    });
    palms.push({
      position: [156, desert.heightAt(156, 176) + 2.1, 176],
      scale: [0.9, 0.9, 0.9],
      rotation: [0.24, 0, -0.14],
    });
    palms.push({
      position: [139, desert.heightAt(139, 168) + 1.9, 168],
      scale: [0.8, 0.8, 0.8],
      rotation: [0.14, 0, 0.26],
    });
    for (const palm of palms) {
      colliders.push({
        type: "cuboid",
        args: [0.28, 2.1, 0.28],
        position: [palm.position[0], palm.position[1] - 1.4, palm.position[2]],
      });
    }
    const twX = 190,
      twZ = 70;
    const twY = desert.heightAt(twX, twZ);
    for (const [dx, dz] of [
      [-1.5, -1.5],
      [1.5, -1.5],
      [-1.5, 1.5],
      [1.5, 1.5],
    ]) {
      const sx = twX + dx,
        sz = twZ + dz;
      const sy = desert.heightAt(sx, sz);
      const len = twY + 5 - sy;
      cactusArms.push({
        position: [sx, sy + len / 2, sz],
        scale: [0.2, len, 0.2],
        rotation: [-dz * 0.05, 0, dx * 0.05],
      });
    }
    colliders.push({
      type: "cuboid",
      args: [2.4, 3.4, 2.4],
      position: [twX, twY + 3.4, twZ],
    });

    // Red Mesa (NE): rock spires ringing the table mountain + boulders.
    const mesa = byId.mesa;
    for (const [x, z, s] of [
      [128, -60, 3.2],
      [250, -60, 4.4],
      [276, -148, 5.2],
      [232, -198, 3.6],
      [126, -188, 4.0],
      [152, -258, 3.0],
      [270, -250, 3.8],
      [198, -38, 2.6],
    ]) {
      const y = mesa.heightAt(x, z);
      spires.push({
        position: [x, y + s / 2 - 0.4, z],
        scale: [1, 1, 1],
        size: s,
      });
      colliders.push({
        type: "cylinder",
        args: [s / 2, s * 0.45],
        position: [x, y + s / 2 - 0.4, z],
      });
    }
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 22; j++) {
        const x = 122 + i * 11.5 + rng() * 8;
        const z = -296 + j * 12.5 + rng() * 8;
        if (x > 292 || onHighwayZ(x) || onHighwayX(z)) continue;
        if (Math.abs(x - 160) < 70 && Math.abs(z + 95) < 62) continue;
        if (rng() < 0.55) continue;
        const y = mesa.heightAt(x, z);
        const s = 0.6 + rng() * 1.7;
        rocks.push({
          position: [x, y + s * 0.3, z],
          scale: [s, s * 0.7, s],
          rotation: [rng(), rng() * 3, rng()],
        });
        if (s > 1.15)
          colliders.push({
            type: "ball",
            args: [s * 0.5],
            position: [x, y + s * 0.3, z],
          });
      }
    }

    // Ember Peaks (W): pine belt on mid slopes, alpine rocks above the tree line.
    const mountains = byId.mountains;
    for (let i = 0; i < 15; i++) {
      for (let j = 0; j < 48; j++) {
        const x = -296 + i * 12 + rng() * 9;
        const z = -296 + j * 12.4 + rng() * 9;
        if (x > -124 || onHighwayX(z)) continue;
        if (rng() < 0.45) continue;
        const y = mountains.heightAt(x, z);
        if (y < 2.5 || y > 27) continue;
        const h = 2.6 + rng() * 2.6;
        pines.push({
          position: [x, y + h / 2 + 0.4, z],
          scale: [h * 0.42, h, h * 0.42],
          rotation: [0, rng() * 3, 0],
        });
        pineTrunks.push({
          position: [x, y + 0.55, z],
          scale: [0.22, 1.1, 0.22],
        });
        if (rng() < 0.35)
          colliders.push({
            type: "cylinder",
            args: [0.55, 0.15],
            position: [x, y + 0.55, z],
          });
      }
    }
    for (let i = 0; i < 14; i++) {
      for (let j = 0; j < 44; j++) {
        const x = -296 + i * 13 + rng() * 9;
        const z = -296 + j * 13.6 + rng() * 9;
        if (x > -124 || onHighwayX(z)) continue;
        const y = mountains.heightAt(x, z);
        if (y < 20 || rng() < 0.65) continue;
        const s = 0.8 + rng() * 1.6;
        rocks.push({
          position: [x, y + s * 0.25, z],
          scale: [s, s * 0.65, s],
          rotation: [rng(), rng() * 3, rng()],
        });
      }
    }

    // ── Highways: flat strips out of the city gates + the climbing pass road ──
    const dashes = [];
    for (let z = -296; z <= -120; z += 8) {
      // Dashes ride 0.02+ above the highway boxes — coplanar surfaces shimmer.
      dashes.push({ position: [0, 0.08, z], scale: [0.14, 0.02, 3.2] });
      dashes.push({ position: [0, 0.08, -z], scale: [0.14, 0.02, 3.2] });
    }
    for (let x = 120; x <= 296; x += 8)
      dashes.push({ position: [x, 0.08, 0], scale: [3.2, 0.02, 0.14] });
    for (let x = -296; x <= -120; x += 8)
      dashes.push({ position: [x, 0.08, 0], scale: [3.2, 0.02, 0.14] });

    const passRoad = [];
    for (let z = -296; z <= -124; z += 6) {
      const h0 = mountains.heightAt(-160, z);
      const h1 = mountains.heightAt(-160, Math.min(-118, z + 6));
      passRoad.push({
        position: [-160, (h0 + h1) / 2 + 0.06, z + 3],
        rotation: [Math.atan2(h0 - h1, 6), 0, 0],
        scale: [8, 0.1, 6.3],
      });
      dashes.push({
        position: [-160, (h0 + h1) / 2 + 0.16, z + 3],
        scale: [0.14, 0.02, 2.6],
      });
    }

    // ── Static colliders: world walls, highways, landmarks ──
    const wallColliders = [
      ...WORLD_BOUNDARY_COLLIDERS,
      { type: "cuboid", args: [5.5, 0.03, 94], position: [0, 0.02, -206] },
      { type: "cuboid", args: [5.5, 0.03, 94], position: [0, 0.02, 206] },
      { type: "cuboid", args: [94, 0.03, 5.5], position: [206, 0.02, 0] },
      { type: "cuboid", args: [94, 0.03, 5.5], position: [-206, 0.02, 0] },
    ];
    const scenery = createDistantScenery();
    const fence = createBoundaryFence();

    return {
      terrains,
      byId,
      regionMeshes,
      cacti,
      cactusArms,
      rocks,
      shrubs,
      pines,
      pineTrunks,
      spires,
      palms,
      dashes,
      passRoad,
      colliders: [
        ...wallColliders,
        ...colliders,
        ...passRoad.map((part) => ({
          type: "cuboid",
          position: part.position,
          rotation: part.rotation,
          args: part.scale.map((value) => value / 2),
        })),
      ],
      fence,
      scenery,
    };
  }, [rapier]);

  // ── Shared geometries & materials (created once, disposed on unmount) ──
  const assets = useMemo(() => {
    const rock = new IcosahedronGeometry(1, 0);
    const cone = new ConeGeometry(1, 1, 7);
    const cyl6 = new CylinderGeometry(1, 1, 1, 6);
    const cylTaper = new CylinderGeometry(0.55, 1, 1, 7);
    const box = new BoxGeometry(1, 1, 1);
    const sand = new Color("#e0c28c");
    const darkRock = new Color("#8c8f85");
    const redRock = new Color("#a8623e");
    const materials = {
      cactus: { color: "#5d8a52", roughness: 0.95 },
      rock: { color: "#9a9186", roughness: 1 },
      shrub: { color: "#a89a60", roughness: 1 },
      pine: { color: "#4a7450", roughness: 0.95 },
      trunk: { color: "#6b5138", roughness: 1 },
      spire: { color: "#b06a44", roughness: 1 },
      palmTrunk: { color: "#8a6a45", roughness: 1 },
      frond: { color: "#5f8f4e", roughness: 0.95 },
      asphalt: { color: "#3a4a4e", roughness: 1 },
      dash: { color: "#d1ba83", roughness: 1 },
      wall: { color: "#d2c4a6", roughness: 1 },
      scenery: { color: "#829a91", roughness: 1 },
      water: {
        color: "#4d94a6",
        roughness: 0.2,
        transparent: true,
        opacity: 0.82,
      },
      sandTint: { color: "#d8bb85", roughness: 1 },
      mesaTop: { color: "#c07a50", roughness: 1 },
    };
    return {
      rock,
      cone,
      cyl6,
      cylTaper,
      box,
      sand,
      darkRock,
      redRock,
      materials,
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(assets).forEach((a) => a.dispose?.());
      data.regionMeshes.forEach((m) => m.geometry.dispose());
    },
    [assets, data],
  );

  const { byId } = data;
  const pondY = byId.desert.heightAt(150, 160);
  const towerY = byId.desert.heightAt(190, 70);

  return (
    <group>
      {/* Base ground — extends past the world walls so nothing shows the void */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.07, 0]}
        receiveShadow
      >
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#b39a6e" roughness={1} />
      </mesh>
      {/* Heightfield terrain — render mesh + matching physics collider */}
      <RigidBody type="fixed" colliders={false} friction={0.95} restitution={0}>
        <HeightfieldCollider
          args={[1, 1, WORLD_FLOOR.heights, WORLD_FLOOR.scale]}
          position={WORLD_FLOOR.position}
        />
        {data.regionMeshes.map((m) => (
          <TrimeshCollider
            key={`terrain-${m.id}`}
            args={m.colliderArgs}
            position={m.center}
            friction={0.95}
          />
        ))}
        {data.colliders.map((c, i) =>
          c.type === "cuboid" ? (
            <CuboidCollider
              key={`wc-${i}`}
              args={c.args}
              position={c.position}
              rotation={c.rotation}
            />
          ) : c.type === "ball" ? (
            <BallCollider key={`wc-${i}`} args={c.args} position={c.position} />
          ) : (
            <CylinderCollider
              key={`wc-${i}`}
              args={c.args}
              position={c.position}
            />
          ),
        )}
      </RigidBody>
      {data.regionMeshes.map((m) => (
        <mesh
          key={m.id}
          geometry={m.geometry}
          position={m.center}
          receiveShadow
        >
          <meshStandardMaterial vertexColors roughness={0.96} metalness={0} />
        </mesh>
      ))}

      {/* Highways out of the city */}
      <mesh position={[0, 0.02, -206]} receiveShadow>
        <boxGeometry args={[11, 0.06, 188]} />
        <meshStandardMaterial color="#3a4a4e" roughness={1} />
      </mesh>
      <mesh position={[0, 0.02, 206]} receiveShadow>
        <boxGeometry args={[11, 0.06, 188]} />
        <meshStandardMaterial color="#3a4a4e" roughness={1} />
      </mesh>
      <mesh position={[206, 0.02, 0]} receiveShadow>
        <boxGeometry args={[188, 0.06, 11]} />
        <meshStandardMaterial color="#3a4a4e" roughness={1} />
      </mesh>
      <mesh position={[-206, 0.02, 0]} receiveShadow>
        <boxGeometry args={[188, 0.06, 11]} />
        <meshStandardMaterial color="#3a4a4e" roughness={1} />
      </mesh>
      {/* Climbing pass road in the Ember Peaks */}
      <Instanced
        items={data.passRoad}
        geometry={assets.box}
        material={makeStd(assets.materials.asphalt)}
        receiveShadow
      />
      <Instanced
        items={data.dashes}
        geometry={assets.box}
        material={makeStd(assets.materials.dash)}
      />

      {/* Desert flora */}
      <Instanced
        items={data.cacti}
        geometry={assets.cyl6}
        material={makeStd(assets.materials.cactus)}
        castShadow
      />
      <Instanced
        items={data.cactusArms}
        geometry={assets.box}
        material={makeStd(assets.materials.cactus)}
        castShadow
      />
      <Instanced
        items={data.shrubs}
        geometry={assets.rock}
        material={makeStd(assets.materials.shrub)}
      />
      {/* Oasis */}
      <mesh position={[150, pondY + 0.07, 160]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[13, 32]} />
        <meshStandardMaterial {...assets.materials.water} />
      </mesh>
      <mesh position={[150, pondY + 0.06, 160]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[13, 15.5, 32]} />
        <meshStandardMaterial color="#e8cf9c" roughness={1} />
      </mesh>
      <Instanced
        items={data.palms}
        geometry={assets.box}
        material={makeStd(assets.materials.palmTrunk)}
        castShadow
      />
      {/* Water tower */}
      <mesh position={[190, towerY + 5.9, 70]} castShadow>
        <cylinderGeometry args={[2.2, 2.2, 2.8, 10]} />
        <meshStandardMaterial color="#9c7a52" roughness={0.9} />
      </mesh>
      <mesh position={[190, towerY + 7.5, 70]} castShadow>
        <coneGeometry args={[2.5, 1.1, 10]} />
        <meshStandardMaterial color="#7c5c3c" roughness={0.9} />
      </mesh>

      {/* Red Mesa landmark + spires */}
      <Instanced
        items={data.spires.map((s) => ({
          position: s.position,
          scale: [s.size * 0.5, s.size, s.size * 0.5],
        }))}
        geometry={assets.cylTaper}
        material={makeStd(assets.materials.spire)}
        castShadow
      />

      {/* Mountain forest */}
      <Instanced
        items={data.pineTrunks}
        geometry={assets.box}
        material={makeStd(assets.materials.trunk)}
      />
      <Instanced
        items={data.pines}
        geometry={assets.cone}
        material={makeStd(assets.materials.pine)}
        castShadow
      />

      {/* Rocks everywhere */}
      <Instanced
        items={data.rocks}
        geometry={assets.rock}
        material={makeStd(assets.materials.rock)}
        castShadow
      />

      <Instanced
        items={data.fence}
        geometry={assets.box}
        material={makeStd(assets.materials.wall)}
      />

      {/* Far scenery ring */}
      {data.scenery.map((s, i) => (
        <mesh key={i} position={s.position}>
          <coneGeometry args={[s.size, s.size * 1.4, 5]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? "#8c9a88" : "#829a91"}
            roughness={1}
          />
        </mesh>
      ))}
    </group>
  );
}

// Small helpers so the collider list can stay data-driven.
const stdCache = new Map();
function makeStd(params) {
  const key = JSON.stringify(params);
  if (!stdCache.has(key)) stdCache.set(key, new MeshStandardMaterial(params));
  return stdCache.get(key);
}
