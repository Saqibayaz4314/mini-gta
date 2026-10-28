import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Object3D } from "three";
import { useFrame } from "@react-three/fiber";
import {
  CapsuleCollider,
  RigidBody,
  useBeforePhysicsStep,
} from "@react-three/rapier";
import { useGameStore } from "../store/gameStore.js";
import { PHYSICS_STEP, clamp } from "../physics.js";
import { BLOCKS } from "../world.js";
import { MOBILE_LIMITS, sampleEvenly } from "../performance.js";

export function Humanoid({ color = "#e9b35a", skin = "#d6a381", animation }) {
  const group = useRef();
  const limbs = useRef([]);
  const phase = useRef(0);
  useFrame((_, dt) => {
    if (!group.current || useGameStore.getState().paused) return;
    const speed = animation.current.speed || 0;
    phase.current += Math.min(dt, 0.05) * speed * 3.2;
    group.current.rotation.y = animation.current.heading || 0;
    const swing = Math.sin(phase.current) * Math.min(speed * 0.22, 0.65);
    limbs.current.forEach((limb, i) => {
      if (limb) limb.rotation.x = swing * (i % 2 === 0 ? 1 : -1);
    });
  });
  return (
    <group ref={group}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[0.42, 0.57, 0.26]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.53, 0]} castShadow>
        <boxGeometry args={[0.3, 0.34, 0.3]} />
        <meshStandardMaterial color={skin} roughness={1} />
      </mesh>
      <mesh position={[0, 0.72, -0.015]} castShadow>
        <boxGeometry args={[0.32, 0.1, 0.33]} />
        <meshStandardMaterial color="#384245" />
      </mesh>
      <mesh position={[0, 0.56, 0.155]}>
        <boxGeometry args={[0.2, 0.055, 0.02]} />
        <meshStandardMaterial color="#293b41" />
      </mesh>
      {[-1, 1].map((side, i) => (
        <group
          key={`arm-${side}`}
          position={[side * 0.29, 0.22, 0]}
          ref={(node) => {
            limbs.current[i] = node;
          }}
        >
          <mesh position={[0, -0.14, 0]} castShadow>
            <boxGeometry args={[0.15, 0.3, 0.2]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position={[0, -0.37, 0]} castShadow>
            <boxGeometry args={[0.13, 0.22, 0.15]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((side, i) => (
        <group
          key={`leg-${side}`}
          position={[side * 0.12, -0.26, 0]}
          ref={(node) => {
            limbs.current[3 - i] = node;
          }}
        >
          <mesh position={[0, -0.22, 0]} castShadow>
            <boxGeometry args={[0.18, 0.44, 0.22]} />
            <meshStandardMaterial color="#334853" />
          </mesh>
          <mesh position={[0, -0.48, 0.04]} castShadow>
            <boxGeometry args={[0.2, 0.12, 0.34]} />
            <meshStandardMaterial color="#e5ddca" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Every pedestrian shares one instanced box mesh. Separate capsules retain full
// physical interaction while hundreds of body parts cost one visual draw call.
const PARTS = [
  { p: [0, 0.03, 0], s: [0.42, 0.57, 0.26], color: "shirt" },
  { p: [0, 0.53, 0], s: [0.3, 0.34, 0.3], color: "#d6a381" },
  { p: [0, 0.72, -0.015], s: [0.32, 0.1, 0.33], color: "#384245" },
  { p: [0, 0.56, 0.155], s: [0.2, 0.055, 0.02], color: "#293b41" },
  ...[-1, 1].flatMap((side, i) => [
    {
      p: [side * 0.29, 0.22, 0],
      offset: -0.14,
      s: [0.15, 0.3, 0.2],
      color: "shirt",
      swing: i ? -1 : 1,
    },
    {
      p: [side * 0.29, 0.22, 0],
      offset: -0.37,
      s: [0.13, 0.22, 0.15],
      color: "#d6a381",
      swing: i ? -1 : 1,
    },
    {
      p: [side * 0.12, -0.26, 0],
      offset: -0.22,
      s: [0.18, 0.44, 0.22],
      color: "#334853",
      swing: i ? 1 : -1,
    },
    {
      p: [side * 0.12, -0.26, 0.04],
      offset: -0.48,
      s: [0.2, 0.12, 0.34],
      color: "#e5ddca",
      swing: i ? 1 : -1,
    },
  ]),
];

export default function NPC({ mobile = false }) {
  const people = useMemo(
    () =>
      (mobile ? sampleEvenly(BLOCKS, MOBILE_LIMITS.pedestrians / 2) : BLOCKS).flatMap((block, i) =>
        [-1, 1].map((side, j) => ({
          id: `${i}-${j}`,
          x: block.x + side * 9.8,
          min: block.z - 8,
          max: block.z + 8,
          start: block.z + ((i % 4) - 1.5) * 4,
          direction: j ? -1 : 1,
          speed: 0.8 + (i % 3) * 0.18,
          color: ["#c77d63", "#ddd2ae", "#608c94", "#948db0", "#749471"][i % 5],
        })),
      ),
    [mobile],
  );
  const bodies = useRef([]);
  const mesh = useRef();
  const motion = useRef(
    people.map((p) => ({ direction: p.direction, speed: 0, phase: 0 })),
  );
  const transforms = useMemo(
    () => ({ root: new Object3D(), part: new Object3D() }),
    [],
  );

  useLayoutEffect(() => {
    people.forEach((person, index) =>
      PARTS.forEach((part, partIndex) => {
        mesh.current.setColorAt(
          index * PARTS.length + partIndex,
          new Color(part.color === "shirt" ? person.color : part.color),
        );
      }),
    );
    mesh.current.instanceColor.needsUpdate = true;
  }, [people]);

  useBeforePhysicsStep(() => {
    const player = useGameStore.getState().playerPosition;
    people.forEach((config, index) => {
      const body = bodies.current[index],
        move = motion.current[index];
      if (!body) return;
      const p = body.translation();
      const near = Math.hypot(p.x - player.x, p.z - player.z) < (mobile ? MOBILE_LIMITS.pedestrianRadius : 95);
      if (body.isEnabled() !== near) body.setEnabled(near);
      if (!near) return;
      if (p.z >= config.max && move.direction > 0) move.direction = -1;
      if (p.z <= config.min && move.direction < 0) move.direction = 1;
      const velocity = body.linvel();
      const maxImpulse = 220 * PHYSICS_STEP;
      body.applyImpulse(
        {
          x: clamp(
            (clamp((config.x - p.x) * 1.4, -1.2, 1.2) - velocity.x) * 65,
            -maxImpulse,
            maxImpulse,
          ),
          y: 0,
          z: clamp(
            (move.direction * config.speed - velocity.z) * 65,
            -maxImpulse,
            maxImpulse,
          ),
        },
        true,
      );
      move.speed = Math.hypot(velocity.x, velocity.z);
      if (
        p.y < -3 ||
        Math.abs(p.x - config.x) > 16 ||
        Math.abs(p.z - (config.min + config.max) / 2) > 20
      ) {
        body.setTranslation(
          { x: config.x, y: 1.05, z: (config.min + config.max) / 2 },
          true,
        );
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    });
  });

  const animationTick = useRef(0);
  const hiddenMatrix = useMemo(() => { const o = new Object3D(); o.scale.setScalar(0); o.updateMatrix(); return o.matrix; }, []);
  useFrame((_, dt) => {
    if (!mesh.current || useGameStore.getState().paused) return;
    animationTick.current += dt;
    if (mobile && animationTick.current < 1 / 30) return;
    dt = animationTick.current; animationTick.current = 0;
    const paused = useGameStore.getState().paused;
    const { root, part: dummy } = transforms;
    people.forEach((person, index) => {
      const body = bodies.current[index],
        move = motion.current[index];
      if (!body) return;
      if (!body.isEnabled()) { PARTS.forEach((_, part) => mesh.current.setMatrixAt(index * PARTS.length + part, hiddenMatrix)); return; }
      const p = body.translation();
      if (!paused) move.phase += Math.min(dt, 0.05) * move.speed * 3.2;
      root.position.set(p.x, p.y, p.z);
      root.rotation.set(0, move.direction > 0 ? 0 : Math.PI, 0);
      root.updateMatrix();
      const swing = Math.sin(move.phase) * Math.min(move.speed * 0.22, 0.65);
      PARTS.forEach((part, partIndex) => {
        const angle = swing * (part.swing || 0),
          offset = part.offset || 0;
        dummy.position.set(
          part.p[0],
          part.p[1] + Math.cos(angle) * offset,
          part.p[2] + Math.sin(angle) * offset,
        );
        dummy.rotation.set(angle, 0, 0);
        dummy.scale.set(...part.s);
        dummy.updateMatrix();
        dummy.matrix.premultiply(root.matrix);
        mesh.current.setMatrixAt(
          index * PARTS.length + partIndex,
          dummy.matrix,
        );
      });
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {people.map((person, i) => (
        <RigidBody
          key={person.id}
          ref={(body) => {
            bodies.current[i] = body;
          }}
          position={[person.x, 1.03, person.start]}
          colliders={false}
          enabledRotations={[false, false, false]}
          // Slow walkers never tunnel — skip CCD on all 72 capsules.
          linearDamping={0.8}
          userData={{ kind: "pedestrian" }}
        >
          <CapsuleCollider
            args={[0.5, 0.29]}
            mass={65}
            friction={0.2}
            restitution={0}
          />
        </RigidBody>
      ))}
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, people.length * PARTS.length]}
        castShadow
        frustumCulled={false}
      >
        <boxGeometry />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </>
  );
}
