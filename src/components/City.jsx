import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  HeightfieldCollider,
  RigidBody,
} from "@react-three/rapier";
import {
  CanvasTexture,
  Color,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { BLOCKS, BUILDINGS, ROAD_CENTERS, random } from "../world.js";

// A two-triangle heightfield gives stable capsule queries across the whole city.
// A single oversized cuboid loses precision near its broad flat face.
const CITY_FLOOR_HEIGHTS = new Float32Array(4);
import { useGameStore } from "../store/gameStore.js";

// One draw call per repeated material; the static world uses explicit box colliders.
function Instances({
  items,
  color,
  material,
  matRef,
  castShadow = false,
  receiveShadow = false,
  geometry = "box",
}) {
  const mesh = useRef();
  useLayoutEffect(() => {
    const dummy = new Object3D();
    items.forEach((item, i) => {
      dummy.position.set(...item.position);
      dummy.rotation.set(...(item.rotation || [0, 0, 0]));
      dummy.scale.set(...(item.scale || [1, 1, 1]));
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
      if (item.color) mesh.current.setColorAt(i, new Color(item.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      material={material}
    >
      {geometry === "box" ? (
        <boxGeometry />
      ) : geometry === "cone" ? (
        <coneGeometry args={[1, 1, 7]} />
      ) : (
        <icosahedronGeometry args={[1, 0]} />
      )}
      {!material && (
        <meshStandardMaterial
          ref={matRef}
          color={color}
          emissive={color}
          emissiveIntensity={0}
          roughness={0.9}
        />
      )}
    </instancedMesh>
  );
}

// ─── 5 Distinct Building Archetypes (all instanced, zero extra draw calls) ──

// Facade generators — each creates a unique canvas texture for a building type
function makeFacade(type) {
  const W = 256,
    H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const seeded = random(type * 7 + 31);

  if (type === 0) {
    // SKYSCRAPER — dark glass curtain wall with blue tint
    ctx.fillStyle = "#2a3d4a";
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < 18; r++) {
      for (let c = 0; c < 6; c++) {
        const lit = seeded() > 0.35;
        ctx.fillStyle = lit ? "#a8d8f0" : "#1a2e3a";
        ctx.fillRect(8 + c * 42, 6 + r * 28, 34, 20);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(8 + c * 42, 6 + r * 28, 34, 3);
      }
      ctx.fillStyle = "rgba(60,100,120,0.2)";
      ctx.fillRect(0, r * 28 + 26, W, 2);
    }
    // horizontal spandrel bands
    for (let r = 0; r < 18; r++) {
      ctx.fillStyle = "rgba(80,140,180,0.15)";
      ctx.fillRect(0, r * 28, W, 6);
    }
  } else if (type === 1) {
    // GLASS TOWER — warm amber/gold reflective
    ctx.fillStyle = "#c4a45a";
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 4; c++) {
        const lit = seeded() > 0.4;
        ctx.fillStyle = lit ? "#ffe8a0" : "#8a6c30";
        ctx.fillRect(10 + c * 62, 8 + r * 32, 52, 22);
        ctx.fillStyle = "rgba(255,240,180,0.12)";
        ctx.fillRect(10 + c * 62, 8 + r * 32, 52, 4);
      }
    }
    ctx.fillStyle = "rgba(200,160,60,0.3)";
    for (let r = 0; r < 16; r++) ctx.fillRect(0, r * 32 + 30, W, 2);
  } else if (type === 2) {
    // ART DECO — cream/stone with ornamental details
    ctx.fillStyle = "#d4c8a8";
    ctx.fillRect(0, 0, W, H);
    const seeded2 = random(type * 13 + 5);
    for (let r = 0; r < 14; r++) {
      ctx.fillStyle = "rgba(30,25,15,0.12)";
      ctx.fillRect(0, r * 36, W, 2);
      for (let c = 0; c < 5; c++) {
        const lit = seeded2() > 0.55;
        ctx.fillStyle = lit ? "#e8d88a" : "#4a4030";
        ctx.fillRect(12 + c * 48, 8 + r * 36, 32, 22);
        // arch top
        ctx.fillStyle = lit ? "#e8d88a" : "#4a4030";
        ctx.beginPath();
        ctx.arc(12 + c * 48 + 16, 8 + r * 36, 8, Math.PI, 0);
        ctx.fill();
      }
    }
    // decorative cornice lines
    for (let i = 1; i < 4; i++) {
      ctx.fillStyle = "rgba(100,90,60,0.3)";
      ctx.fillRect(0, Math.floor((H * i) / 4), W, 4);
    }
  } else if (type === 3) {
    // COMMERCIAL BLOCK — brick red/terracotta
    ctx.fillStyle = "#9a5a3c";
    ctx.fillRect(0, 0, W, H);
    // Brick pattern
    const seeded3 = random(type * 17 + 9);
    for (let r = 0; r < H / 8; r++) {
      const offset = r % 2 === 0 ? 0 : 16;
      for (let c = -1; c < W / 32; c++) {
        ctx.fillStyle = `hsl(${12 + seeded3() * 8},${40 + seeded3() * 15}%,${28 + seeded3() * 10}%)`;
        ctx.fillRect(c * 32 + offset, r * 8, 30, 6);
      }
    }
    // Windows
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 4; c++) {
        const lit = seeded() > 0.5;
        ctx.fillStyle = lit ? "#f0d890" : "#2a2010";
        ctx.fillRect(16 + c * 56, 12 + r * 50, 36, 28);
      }
    }
  } else {
    // LOW-RISE / WAREHOUSE — grey concrete, industrial
    ctx.fillStyle = "#7a8a88";
    ctx.fillRect(0, 0, W, H);
    // Panel lines
    for (let r = 0; r < 8; r++) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, r * 64, W, 3);
    }
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(c * 64, 0, 3, H);
    }
    // Large industrial windows
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        const lit = seeded() > 0.6;
        ctx.fillStyle = lit ? "#d4e8d0" : "#303830";
        ctx.fillRect(14 + c * 82, 16 + r * 82, 62, 50);
        // Window panes
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(14 + c * 82 + 30, 16 + r * 82, 2, 50);
        ctx.fillRect(14 + c * 82, 16 + r * 82 + 24, 62, 2);
      }
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// Classify each building into one of 5 types by height
function buildingType(b) {
  if (b.height >= 22) return 0; // skyscraper
  if (b.height >= 16) return 1; // glass tower
  if (b.height >= 11) return 2; // art deco
  if (b.height >= 7) return 3; // commercial
  return 4; // low-rise / warehouse
}

function Buildings() {
  const textures = useMemo(() => [0, 1, 2, 3, 4].map(makeFacade), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  // Group buildings by type for one instanced mesh per type
  const groups = useMemo(
    () =>
      [0, 1, 2, 3, 4].map((t) =>
        BUILDINGS.filter((b) => buildingType(b) === t).map((b) => ({
          position: [b.x, b.height / 2 + 0.18, b.z],
          scale: [b.width, b.height, b.depth],
        })),
      ),
    [],
  );

  // Rooftop variety by type
  const { roofs, roofAccents, antennae, waterTanks, acUnits } = useMemo(() => {
    const roofs = [],
      roofAccents = [],
      antennae = [],
      waterTanks = [],
      acUnits = [];
    BUILDINGS.forEach((b) => {
      const t = buildingType(b);
      const top = b.height + 0.18;

      // All buildings get a roof cap
      roofs.push({
        position: [b.x, top + 0.15, b.z],
        scale: [b.width + 0.4, 0.3, b.depth + 0.4],
        color:
          t === 0
            ? "#2a3840"
            : t === 1
              ? "#786030"
              : t === 2
                ? "#c0b490"
                : t === 3
                  ? "#5a3820"
                  : "#555f5e",
      });

      if (t === 0) {
        // Skyscraper — tall antenna spire
        antennae.push({
          position: [b.x, top + 2.5, b.z],
          scale: [0.18, 5, 0.18],
          color: "#8aacb8",
        });
        // Step-back upper floors (setback box)
        roofAccents.push({
          position: [b.x, top + 0.6, b.z],
          scale: [b.width * 0.65, 1.2, b.depth * 0.65],
          color: "#2a3840",
        });
      } else if (t === 1) {
        // Glass tower — pyramid cap
        roofAccents.push({
          position: [b.x, top + 1.5, b.z],
          scale: [b.width * 0.5, 3, b.depth * 0.5],
          color: "#c4a050",
        });
      } else if (t === 2) {
        // Art deco — stepped crown
        roofAccents.push({
          position: [b.x, top + 0.5, b.z],
          scale: [b.width * 0.7, 1, b.depth * 0.7],
          color: "#c8bc90",
        });
        roofAccents.push({
          position: [b.x, top + 1.1, b.z],
          scale: [b.width * 0.4, 0.8, b.depth * 0.4],
          color: "#d4c898",
        });
      } else if (t === 3) {
        // Commercial — water tank
        waterTanks.push({
          position: [b.x + 1.2, top + 0.9, b.z - 0.5],
          scale: [1.2, 1.8, 1.2],
          color: "#8a6840",
        });
      } else {
        // Warehouse — large AC/HVAC units
        acUnits.push({
          position: [b.x - 0.5, top + 0.4, b.z + 0.3],
          scale: [2.2, 0.8, 1.4],
          color: "#7a8880",
        });
        acUnits.push({
          position: [b.x + 1.5, top + 0.4, b.z - 0.8],
          scale: [1.6, 0.7, 1.0],
          color: "#6a7870",
        });
      }
    });
    return { roofs, roofAccents, antennae, waterTanks, acUnits };
  }, []);

  return (
    <>
      {groups.map((items, i) =>
        items.length > 0 ? (
          <BuildingBatch key={i} items={items} texture={textures[i]} />
        ) : null,
      )}
      <Instances items={roofs} color="#485858" castShadow />
      {roofAccents.length > 0 && (
        <Instances items={roofAccents} color="#555" castShadow />
      )}
      {antennae.length > 0 && <Instances items={antennae} color="#8aacb8" />}
      {waterTanks.length > 0 && (
        <Instances items={waterTanks} color="#8a6840" castShadow />
      )}
      {acUnits.length > 0 && <Instances items={acUnits} color="#7a8880" />}
    </>
  );
}

function BuildingBatch({ items, texture }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const object = new Object3D();
    items.forEach((item, index) => {
      object.position.set(...item.position);
      object.scale.set(...item.scale);
      object.updateMatrix();
      ref.current.setMatrixAt(index, object.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry />
      {[0, 1, 4, 5].map((face) => (
        <meshStandardMaterial
          key={face}
          attach={`material-${face}`}
          map={texture}
          roughness={0.88}
        />
      ))}
      <meshStandardMaterial attach="material-2" color="#667370" roughness={1} />
      <meshStandardMaterial attach="material-3" color="#444c4c" roughness={1} />
    </instancedMesh>
  );
}

// Night level helper — 0 = day, 1 = full night
function nightLevel(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 19) return 0;
  if (h >= 19 && h < 21) return (h - 19) / 2;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return 1;
}

// Per-building window glow — thin emissive panels on each face, fades in at night
function CityNightGlow() {
  const meshRef = useRef();
  const matRef = useRef();

  // Pre-compute one emissive rect per face per building (4 × all buildings)
  const items = useMemo(() => {
    const list = [];
    BUILDINGS.forEach((b) => {
      const hw = b.width / 2;
      const hd = b.depth / 2;
      const midY = b.height * 0.42;
      const bandH = Math.min(b.height * 0.38, 4.5);
      // Front / Back
      list.push(
        {
          pos: [b.x, midY, b.z + hd + 0.07],
          sx: b.width * 0.72,
          sy: bandH,
          sz: 0.05,
        },
        {
          pos: [b.x, midY, b.z - hd - 0.07],
          sx: b.width * 0.72,
          sy: bandH,
          sz: 0.05,
        },
        // Left / Right
        {
          pos: [b.x + hw + 0.07, midY, b.z],
          sx: 0.05,
          sy: bandH,
          sz: b.depth * 0.72,
        },
        {
          pos: [b.x - hw - 0.07, midY, b.z],
          sx: 0.05,
          sy: bandH,
          sz: b.depth * 0.72,
        },
      );
      // Upper band for tall buildings
      if (b.height >= 14) {
        const topY = b.height * 0.76;
        const topH = Math.min(b.height * 0.18, 3);
        list.push(
          {
            pos: [b.x, topY, b.z + hd + 0.07],
            sx: b.width * 0.6,
            sy: topH,
            sz: 0.05,
          },
          {
            pos: [b.x, topY, b.z - hd - 0.07],
            sx: b.width * 0.6,
            sy: topH,
            sz: 0.05,
          },
        );
      }
    });
    return list;
  }, []);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const dummy = new Object3D();
    items.forEach(({ pos, sx, sy, sz }, i) => {
      dummy.position.set(...pos);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();
  }, [items]);

  useFrame(() => {
    if (!matRef.current) return;
    const ni = nightLevel(useGameStore.getState().gameHour ?? 17);
    if (meshRef.current) meshRef.current.visible = ni > 0.01;
    matRef.current.opacity = ni * 0.82;
    matRef.current.emissiveIntensity = ni * 1.4;
  });

  if (!items.length) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, items.length]}>
      <boxGeometry />
      <meshStandardMaterial
        ref={matRef}
        color="#ffb060"
        emissive="#ffb060"
        emissiveIntensity={0}
        roughness={0.4}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

export default function City() {
  const lampMatRef = useRef();
  useFrame(() => {
    if (!lampMatRef.current) return;
    const ni = nightLevel(useGameStore.getState().gameHour ?? 17);
    lampMatRef.current.emissiveIntensity = ni * 3.5;
  });

  const details = useMemo(() => {
    const dashes = [],
      crosswalks = [],
      edges = [],
      trunks = [],
      leaves = [],
      poles = [],
      lamps = [],
      benches = [];
    for (const road of ROAD_CENTERS) {
      for (let along = -107; along <= 107; along += 6) {
        if (ROAD_CENTERS.some((cross) => Math.abs(along - cross) < 6)) continue;
        dashes.push(
          { position: [road, 0.032, along], scale: [0.1, 0.025, 2.5] },
          { position: [along, 0.034, road], scale: [2.5, 0.025, 0.1] },
        );
      }
      for (const cross of ROAD_CENTERS) {
        for (let stripe = -3; stripe <= 3; stripe++) {
          for (const side of [-1, 1]) {
            crosswalks.push({
              position: [road + stripe * 0.9, 0.03, cross + side * 5.6],
              scale: [0.45, 0.025, 1.5],
            });
            crosswalks.push({
              position: [road + side * 5.6, 0.03, cross + stripe * 0.9],
              scale: [1.5, 0.025, 0.45],
            });
          }
        }
      }
    }
    for (const block of BLOCKS) {
      edges.push(
        {
          position: [block.x, 0.19, block.z - 10.85],
          scale: [21.6, 0.03, 0.12],
        },
        {
          position: [block.x - 10.85, 0.19, block.z],
          scale: [0.12, 0.03, 21.6],
        },
      );
      for (const side of [-1, 1]) {
        const x = block.x + side * 9.7,
          z = block.z - 9.5;
        poles.push({ position: [x, 2.25, z], scale: [0.1, 4.2, 0.1] });
        lamps.push({
          position: [x + side * 0.45, 4.3, z],
          scale: [1.1, 0.12, 0.35],
        });
      }
      const treePoints = block.park
        ? [
            [-7, -7],
            [7, -7],
            [-7, 7],
            [7, 7],
            [0, -7],
            [0, 7],
          ]
        : [[9, 8]];
      treePoints.forEach(([x, z]) => {
        trunks.push({
          position: [block.x + x, 1.3, block.z + z],
          scale: [0.28, 2.3, 0.28],
        });
        leaves.push({
          position: [block.x + x, 3.2, block.z + z],
          scale: [1.5, 2, 1.5],
          color: block.park ? "#507b62" : "#688773",
        });
      });
      if (block.park)
        benches.push({
          position: [block.x + 5, 0.65, block.z],
          scale: [0.6, 0.45, 2.4],
        });
    }
    return { dashes, crosswalks, edges, trunks, leaves, poles, lamps, benches };
  }, []);
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.04, 0]}
        receiveShadow
      >
        <planeGeometry args={[224, 224]} />
        <meshStandardMaterial color="#809d91" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[220, 220]} />
        <meshStandardMaterial color="#38494d" roughness={1} />
      </mesh>
      {BLOCKS.map((block) => (
        <group key={`${block.x}:${block.z}`}>
          <mesh position={[block.x, 0.08, block.z]} receiveShadow>
            <boxGeometry args={[22, 0.16, 22]} />
            <meshStandardMaterial color="#b2b6a6" roughness={1} />
          </mesh>
          {block.park && (
            <>
              <mesh position={[block.x, 0.17, block.z]} receiveShadow>
                <boxGeometry args={[17, 0.025, 17]} />
                <meshStandardMaterial color="#759679" />
              </mesh>
              <mesh position={[block.x, 0.195, block.z]}>
                <boxGeometry args={[3, 0.03, 18]} />
                <meshStandardMaterial color="#c8bfa5" />
              </mesh>
              <mesh position={[block.x, 0.2, block.z]}>
                <boxGeometry args={[18, 0.03, 3]} />
                <meshStandardMaterial color="#c8bfa5" />
              </mesh>
              <mesh position={[block.x, 1.3, block.z]} castShadow>
                <octahedronGeometry args={[1.3]} />
                <meshStandardMaterial
                  color="#e3aa63"
                  metalness={0.65}
                  roughness={0.3}
                />
              </mesh>
            </>
          )}
        </group>
      ))}
      <Buildings />
      <CityNightGlow />
      <Instances items={details.dashes} color="#d1ba83" />
      <Instances items={details.crosswalks} color="#c4c9bd" />
      <Instances items={details.edges} color="#e1d7ba" />
      <Instances items={details.trunks} color="#716955" castShadow />
      <Instances
        items={details.leaves}
        color="#668c72"
        geometry="ico"
        castShadow
      />
      <Instances items={details.poles} color="#50605c" />
      <Instances items={details.benches} color="#906c48" castShadow />
      <Instances items={details.lamps} color="#f1d5a3" matRef={lampMatRef} />
      <RigidBody type="fixed" colliders={false} friction={0.95} restitution={0}>
        <HeightfieldCollider
          args={[1, 1, CITY_FLOOR_HEIGHTS, { x: 224, y: 1, z: 224 }]}
        />
        {BLOCKS.map((block) => (
          <CuboidCollider
            key={`curb-${block.x}:${block.z}`}
            args={[11, 0.08, 11]}
            position={[block.x, 0.08, block.z]}
          />
        ))}
        {BUILDINGS.map((b, i) => (
          <CuboidCollider
            key={`building-${i}`}
            args={[b.width / 2, b.height / 2, b.depth / 2]}
            position={[b.x, b.height / 2 + 0.16, b.z]}
          />
        ))}
        {BLOCKS.filter((b) => b.park).map((b) => (
          <CuboidCollider
            key={`art-${b.x}`}
            args={[0.8, 1.2, 0.8]}
            position={[b.x, 1.2, b.z]}
          />
        ))}
        {[-1, 1].map((side) => (
          <group key={side}>
            {/* Gate opening at the highway (center), walls flank both sides */}
            <CuboidCollider
              args={[0.5, 2, 50]}
              position={[side * 112, 1, -62]}
            />
            <CuboidCollider
              args={[0.5, 2, 50]}
              position={[side * 112, 1, 62]}
            />
            <CuboidCollider
              args={[50, 2, 0.5]}
              position={[-62, 1, side * 112]}
            />
            <CuboidCollider
              args={[50, 2, 0.5]}
              position={[62, 1, side * 112]}
            />
          </group>
        ))}
      </RigidBody>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 112, 0.5, -62]}>
            <boxGeometry args={[0.5, 1, 100]} />
            <meshStandardMaterial color="#d2c4a6" />
          </mesh>
          <mesh position={[side * 112, 0.5, 62]}>
            <boxGeometry args={[0.5, 1, 100]} />
            <meshStandardMaterial color="#d2c4a6" />
          </mesh>
          <mesh position={[-62, 0.5, side * 112]}>
            <boxGeometry args={[100, 1, 0.5]} />
            <meshStandardMaterial color="#d2c4a6" />
          </mesh>
          <mesh position={[62, 0.5, side * 112]}>
            <boxGeometry args={[100, 1, 0.5]} />
            <meshStandardMaterial color="#d2c4a6" />
          </mesh>
          {/* Gate pillars marking the highway exits */}
          {[-12, 12].map((offset) => (
            <group key={offset}>
              <mesh position={[side * 112, 1.4, offset]} castShadow>
                <boxGeometry args={[1.1, 2.8, 1.1]} />
                <meshStandardMaterial color="#c8b898" />
              </mesh>
              <mesh position={[offset, 1.4, side * 112]} castShadow>
                <boxGeometry args={[1.1, 2.8, 1.1]} />
                <meshStandardMaterial color="#c8b898" />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
