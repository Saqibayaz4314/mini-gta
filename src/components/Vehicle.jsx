/* oxlint-disable react/immutability -- Physics callbacks intentionally update mutable input refs and Rapier objects. */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, Matrix4, Object3D } from "three";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
} from "@react-three/rapier";
import { useGameStore } from "../store/gameStore.js";
import {
  CAR,
  PHYSICS_STEP,
  angleDelta,
  clamp,
  createCarController,
  headingFromRotation,
  stepCar,
  findVehicleRecovery,
} from "../physics.js";
import { CITY_LIMIT } from "../world.js";
import { hasLostTerrainSupport } from "../terrain.js";
import { playSqueal, updateEngine } from "../audio.js";

export default function Vehicle({
  config,
  controls,
  registry,
  mobile = false,
}) {
  const body = useRef();
  const visual = useRef();
  const controller = useRef();
  const brakeLights = useRef();
  const nitroExhaust = useRef();
  const telemetry = useRef({ speed: 0, contacts: 0, steer: 0 });
  const publishAt = useRef(0);
  const impactVelocity = useRef({ x: 0, z: 0 });
  const lastSafe = useRef({
    x: config.position[0],
    y: config.position[1],
    z: config.position[2],
    heading: config.heading,
  });
  const { world, rapier } = useRapier();
  const trafficShape = useMemo(
    () => new rapier.Cuboid(0.8, 0.25, 0.12),
    [rapier],
  );
  const controlled = useGameStore(
    (state) => state.activeVehicleId === config.id,
  );
  const hasDriver = useGameStore(
    (state) => state.vehicles[config.id]?.hasNpcDriver ?? config.isTraffic,
  );

  useEffect(() => {
    const rigidBody = body.current;
    const entries = registry.current;
    const vehicle = createCarController(world, rigidBody);
    controller.current = vehicle;
    entries.set(config.id, { body: rigidBody, config, controller: vehicle });
    useGameStore.getState().registerVehicle({
      id: config.id,
      position: rigidBody.translation(),
      heading: config.heading,
      isTraffic: config.isTraffic,
    });
    return () => {
      entries.delete(config.id);
      useGameStore.getState().removeVehicle(config.id);
      world.removeVehicleController(vehicle);
      controller.current = null;
    };
  }, [world, config, registry]);

  useBeforePhysicsStep(() => {
    const rigidBody = body.current,
      vehicle = controller.current;
    if (!rigidBody || !vehicle) return;
    const state = useGameStore.getState();
    const data = state.vehicles[config.id];
    if (!data) return;
    const p = rigidBody.translation();
    const velocityBefore = rigidBody.linvel();
    impactVelocity.current = { x: velocityBefore.x, z: velocityBefore.z };
    const heading = headingFromRotation(rigidBody.rotation());
    const active = state.activeVehicleId === config.id;
    const player = state.playerPosition;
    const near =
      active ||
      Math.hypot(p.x - player.x, p.z - player.z) < (mobile ? 65 : 130);
    if (visual.current) visual.current.visible = near;
    if (rigidBody.isEnabled() !== near) {
      rigidBody.setEnabled(near);
      if (!near) rigidBody.sleep();
    }
    if (!near) return;
    const needsCcd =
      active || Math.hypot(velocityBefore.x, velocityBefore.z) > 9;
    if (rigidBody.isCcdEnabled() !== needsCcd) rigidBody.enableCcd(needsCcd);
    let input = { parked: true };
    const lostSupport = hasLostTerrainSupport(p);
    if (
      (active && controls.current.recover) ||
      (!data.autoDrive && lostSupport)
    ) {
      const pose = lastSafe.current;
      const recovery = findVehicleRecovery(
        world,
        rapier,
        rigidBody,
        pose,
        pose.heading,
      );
      if (active) controls.current.recover = false;
      if (!recovery) return;
      rigidBody.setTranslation(recovery, true);
      rigidBody.setRotation(
        {
          x: 0,
          y: Math.sin(pose.heading / 2),
          z: 0,
          w: Math.cos(pose.heading / 2),
        },
        true,
      );
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      state.updateVehiclePose(config.id, recovery, pose.heading);
      if (active) {
        state.setPlayerPosition(recovery);
        state.setTelemetry(0, 0);
        state.setNitro(telemetry.current.nitroCharge ?? 1, false);
      }
      if (nitroExhaust.current) nitroExhaust.current.visible = false;
      return;
    }
    if (active) {
      const keys = controls.current.keys;
      input = {
        throttle:
          Number(keys.has("KeyW") || keys.has("ArrowUp")) -
          Number(keys.has("KeyS") || keys.has("ArrowDown")),
        steer:
          Number(keys.has("KeyA") || keys.has("ArrowLeft")) -
          Number(keys.has("KeyD") || keys.has("ArrowRight")),
        brake: keys.has("KeyB"),
        handbrake: keys.has("Space"),
        boost: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      };

      if (input.throttle || input.steer || input.brake || input.handbrake)
        rigidBody.wakeUp();
    } else if (data.autoDrive) {
      const forward = {
        x: Math.sin(config.heading),
        z: Math.cos(config.heading),
      };
      const laneError =
        config.axis === "z"
          ? (config.lane - p.x) * forward.z
          : -(config.lane - p.z) * forward.x;
      const targetHeading =
        config.heading + clamp(laneError * 0.12, -0.45, 0.45);
      const velocity = rigidBody.linvel();
      const forwardSpeed =
        velocity.x * Math.sin(heading) + velocity.z * Math.cos(heading);
      const obstacle = world.castShape(
        { x: p.x + forward.x * 2.1, y: p.y + 0.1, z: p.z + forward.z * 2.1 },
        rigidBody.rotation(),
        { x: forward.x, y: 0, z: forward.z },
        trafficShape,
        0.03,
        9,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        rigidBody,
      );
      const targetSpeed =
        6.5 * (obstacle ? clamp((obstacle.time_of_impact - 1.5) / 7, 0, 1) : 1);
      input = {
        throttle: clamp((targetSpeed - forwardSpeed) * 0.45, 0, 1),
        steer: clamp(angleDelta(targetHeading, heading) * 3, -1, 1),
        brake: targetSpeed < forwardSpeed - 0.5,
      };
      const along = config.axis === "z" ? p.z : p.x;
      if (Math.abs(along) > CITY_LIMIT - 6 || lostSupport) {
        const alongSpawn =
          -Math.sign(config.axis === "z" ? forward.z : forward.x) *
          (CITY_LIMIT - 8);
        const spawn =
          config.axis === "z"
            ? { x: config.lane, y: 0.9, z: alongSpawn }
            : { x: alongSpawn, y: 0.9, z: config.lane };
        const orientation = {
          x: 0,
          y: Math.sin(config.heading / 2),
          z: 0,
          w: Math.cos(config.heading / 2),
        };
        const occupied = world.intersectionWithShape(
          { ...spawn, y: 1.2 },
          orientation,
          new rapier.Cuboid(1.1, 0.65, 2.2),
          rapier.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          undefined,
          rigidBody,
        );
        if (!occupied) {
          rigidBody.setTranslation(spawn, true);
          rigidBody.setRotation(
            {
              x: 0,
              y: Math.sin(config.heading / 2),
              z: 0,
              w: Math.cos(config.heading / 2),
            },
            true,
          );
          rigidBody.setLinvel(
            { x: forward.x * 3, y: 0, z: forward.z * 3 },
            true,
          );
          rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        } else {
          input.throttle = 0;
          input.brake = true;
        }
      }
      rigidBody.wakeUp();
    }
    if (!rigidBody.isSleeping() || active || data.autoDrive) {
      telemetry.current = stepCar(
        vehicle,
        rigidBody,
        input,
        PHYSICS_STEP,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      );
    }
    if (brakeLights.current)
      brakeLights.current.visible = Boolean(
        input.brake || input.handbrake || input.parked,
      );
    if (nitroExhaust.current)
      nitroExhaust.current.visible = Boolean(
        active && telemetry.current.boosting,
      );
    publishAt.current += PHYSICS_STEP;
    if (publishAt.current >= 0.1) {
      publishAt.current = 0;
      const q = rigidBody.rotation();
      if (
        telemetry.current.contacts >= 3 &&
        1 - 2 * (q.x * q.x + q.z * q.z) > 0.7 &&
        !hasLostTerrainSupport(p, 0.5)
      )
        lastSafe.current = { x: p.x, y: p.y, z: p.z, heading };
      state.updateVehiclePose(
        config.id,
        rigidBody.translation(),
        headingFromRotation(rigidBody.rotation()),
      );
      if (active) {
        state.setPlayerPosition(rigidBody.translation());
        state.setTelemetry(telemetry.current.speed, telemetry.current.contacts);
        state.setNitro(
          telemetry.current.nitroCharge,
          telemetry.current.boosting,
        );
        state.setPlayerHeading(headingFromRotation(rigidBody.rotation()));
        const motion = telemetry.current;
        playSqueal(
          motion.contacts >= 2 &&
            Math.abs(motion.speed) > 4 &&
            (motion.sliding || motion.handbrake),
        );
        updateEngine(
          Math.abs(motion.speed) * 3.6,
          motion.braking,
          motion.boosting,
        );
      }
    }
  });

  return (
    <RigidBody
      ref={body}
      position={config.position}
      rotation={[0, config.heading, 0]}
      colliders={false}
      linearDamping={0.12}
      angularDamping={0.6}
      // Fast traffic hit by another car also enables CCD in the physics callback.
      ccd={controlled}
      canSleep
      onCollisionEnter={({ other }) => {
        if (other.rigidBody?.userData?.kind !== "player") return;
        const velocity = impactVelocity.current;
        if (Math.hypot(velocity.x, velocity.z) > 3)
          controls.current.knockback = {
            x: velocity.x * 0.8,
            z: velocity.z * 0.8,
          };
      }}
      userData={{ kind: "vehicle", id: config.id }}
    >
      <CuboidCollider
        args={[0.88, 0.25, 1.85]}
        mass={CAR.mass}
        friction={0.3}
        restitution={0.02}
      />
      <CuboidCollider
        args={[0.72, 0.3, 0.95]}
        position={[0, 0.54, -0.15]}
        mass={0}
        friction={0.3}
        restitution={0.02}
      />
      <group ref={visual}>
        <CarShell color={config.color} />
        <group ref={nitroExhaust} visible={false}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.58, -0.03, -2.18]}>
              <boxGeometry args={[0.14, 0.12, 0.55]} />
              <meshBasicMaterial color="#77eaff" toneMapped={false} />
            </mesh>
          ))}
        </group>
        <mesh position={[0, 0.58, -0.16]}>
          <boxGeometry args={[1.5, 0.6, 1.95]} />
          <meshStandardMaterial
            color="#344f59"
            roughness={0.2}
            metalness={0.25}
            transparent
            opacity={0.58}
            depthWrite={false}
          />
        </mesh>
        <group ref={brakeLights}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.6, 0.22, -1.94]}>
              <boxGeometry args={[0.43, 0.14, 0.025]} />
              <meshBasicMaterial color="#ff654d" />
            </mesh>
          ))}
        </group>
        {hasDriver && (
          <group position={[-0.38, 0.39, 0.02]}>
            <mesh>
              <boxGeometry args={[0.32, 0.4, 0.24]} />
              <meshStandardMaterial color="#323c44" />
            </mesh>
            <mesh position={[0, 0.29, 0.03]}>
              <boxGeometry args={[0.22, 0.23, 0.22]} />
              <meshStandardMaterial color="#ca9c77" />
            </mesh>
          </group>
        )}
        <VehicleWheels controller={controller} visual={visual} />
      </group>
    </RigidBody>
  );
}

function CarShell({ color }) {
  const mesh = useRef();
  const parts = useMemo(
    () => [
      { p: [0, 0.16, 0], s: [1.82, 0.5, 3.8], color },
      { p: [0, 0.91, -0.16], s: [1.55, 0.09, 2.03], color },
      { p: [0, 0.13, -2.01], s: [0.5, 0.14, 0.02], color: "#efe8c9" },
      ...[-1, 1].flatMap((side) => [
        { p: [side * 0.77, 0.57, -0.18], s: [0.06, 0.61, 0.09], color },
        { p: [side * 1, 0.48, 0.72], s: [0.25, 0.15, 0.3], color },
        {
          p: [side * 0.57, 0.22, 1.92],
          s: [0.48, 0.18, 0.025],
          color: "#fff0bf",
        },
        {
          p: [side * 0.6, 0.22, -1.92],
          s: [0.43, 0.14, 0.025],
          color: "#aa453a",
        },
        {
          p: [side * 0.92, 0.13, -0.45],
          s: [0.035, 0.07, 0.28],
          color: "#e0d5be",
        },
        { p: [0, -0.05, side * 1.94], s: [1.85, 0.14, 0.12], color: "#3a4445" },
      ]),
    ],
    [color],
  );
  useLayoutEffect(() => {
    const dummy = new Object3D();
    parts.forEach((part, i) => {
      dummy.position.set(...part.p);
      dummy.scale.set(...part.s);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
      mesh.current.setColorAt(i, new Color(part.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [parts]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, parts.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry />
      <meshStandardMaterial roughness={0.42} metalness={0.2} />
    </instancedMesh>
  );
}

function VehicleWheels({ controller, visual }) {
  const tyres = useRef(),
    rims = useRef(),
    spokes = useRef();
  const transforms = useMemo(
    () => ({
      wheel: new Object3D(),
      cylinder: new Matrix4().makeRotationZ(Math.PI / 2),
      shift: new Matrix4(),
      matrix: new Matrix4(),
    }),
    [],
  );
  useFrame(() => {
    const vehicle = controller.current;
    if (!vehicle || !visual.current?.visible || useGameStore.getState().paused)
      return;
    const { wheel, cylinder, shift, matrix } = transforms;
    CAR.wheelPositions.forEach((point, i) => {
      wheel.position.set(
        point.x,
        -(vehicle.wheelSuspensionLength(i) ?? CAR.suspensionLength),
        point.z,
      );
      wheel.rotation.set(
        vehicle.wheelRotation(i) || 0,
        vehicle.wheelSteering(i) || 0,
        0,
        "YXZ",
      );
      wheel.updateMatrix();
      matrix.copy(wheel.matrix).multiply(cylinder);
      tyres.current.setMatrixAt(i, matrix);
      rims.current.setMatrixAt(i, matrix);
      matrix
        .copy(wheel.matrix)
        .multiply(shift.makeTranslation(Math.sign(point.x) * 0.135, 0, 0));
      spokes.current.setMatrixAt(i, matrix);
    });
    for (const ref of [tyres, rims, spokes])
      ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh
        ref={tyres}
        args={[undefined, undefined, 4]}
        castShadow
        frustumCulled={false}
      >
        <cylinderGeometry args={[CAR.wheelRadius, CAR.wheelRadius, 0.24, 12]} />
        <meshStandardMaterial color="#263035" roughness={0.95} />
      </instancedMesh>
      <instancedMesh
        ref={rims}
        args={[undefined, undefined, 4]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.2, 0.2, 0.255, 8]} />
        <meshStandardMaterial
          color="#bdc5be"
          roughness={0.35}
          metalness={0.7}
        />
      </instancedMesh>
      <instancedMesh
        ref={spokes}
        args={[undefined, undefined, 4]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.02, 0.07, 0.37]} />
        <meshStandardMaterial color="#525e60" />
      </instancedMesh>
    </>
  );
}
