/* oxlint-disable react/immutability -- Rapier and Three are imperative APIs; frame callbacks intentionally update engine objects and shared input refs. */
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CapsuleCollider,
  Physics,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
} from "@react-three/rapier";
import { Quaternion, Vector3 } from "three";
import City from "./components/City.jsx";
import FrameClock from "./components/FrameClock.jsx";
import { MOBILE_LIMITS, sampleEvenly } from "./performance.js";
import HUD from "./components/HUD.jsx";
import Terrain from "./components/Terrain.jsx";
import { hasLostTerrainSupport } from "./terrain.js";
import { CHECKPOINTS, TRAFFIC } from "./world.js";
import Vehicle from "./components/Vehicle.jsx";
import NPC, { Humanoid } from "./components/NPC.jsx";
import {
  GAME_MODES,
  HIJACK_DISTANCE,
  PLAYER_SPAWN,
  useGameStore,
} from "./store/gameStore.js";
import {
  PHYSICS_STEP,
  clamp,
  createWalkingController,
  findSafeExit,
  findCharacterRecovery,
  headingFromRotation,
  angleDelta,
  cameraClearance,
  hasVehicleAccess,
} from "./physics.js";
import "./App.css";
import {
  playCheckpoint,
  playHijack,
  playSqueal,
  startEngine,
  stopEngine,
  setAudioPaused,
} from "./audio.js";

const createControls = () => ({
  keys: new Set(),
  interact: false,
  jump: false,
  recover: false,
  yaw: Math.PI,
  orbit: 0,
  orbitTime: 0,
  pitch: 0.43,
  zoom: 1,
  knockback: { x: 0, z: 0 },
});
const distance2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
class GameBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch() {
    useGameStore.getState().setWorldReady(true);
  }
  render() {
    if (this.state.error)
      return (
        <div className="error-screen">
          <h1>The city could not load.</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Reload city</button>
        </div>
      );
    return this.props.children;
  }
}

function Player({ controls, playerBody }) {
  const collider = useRef();
  const controller = useRef();
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  const animation = useRef({ heading: Math.PI, speed: 0 });
  const timer = useRef(0);
  const lastSafe = useRef({ ...PLAYER_SPAWN });
  const wasWalking = useRef(true);
  const { world, rapier } = useRapier();
  const walking = useGameStore((s) => s.mode === GAME_MODES.WALKING);
  useEffect(() => {
    const character = createWalkingController(world);
    controller.current = character;
    return () => {
      world.removeCharacterController(character);
      controller.current = null;
    };
  }, [world]);

  useBeforePhysicsStep(() => {
    const body = playerBody.current,
      character = controller.current;
    if (!body || !character || !collider.current) return;
    const state = useGameStore.getState(),
      input = controls.current;
    if (state.mode !== GAME_MODES.WALKING) {
      wasWalking.current = false;
      if (body.isEnabled()) body.setEnabled(false);
      velocity.current = { x: 0, y: 0, z: 0 };
      return;
    }
    if (!body.isEnabled()) {
      body.setTranslation(state.playerPosition, true);
      body.setNextKinematicTranslation(state.playerPosition);
      body.setEnabled(true);
    }
    if (!wasWalking.current) {
      lastSafe.current = { ...state.playerPosition };
      wasWalking.current = true;
    }
    const p = body.translation();
    if (input.recover || hasLostTerrainSupport(p, 1.1)) {
      const recovery =
        findCharacterRecovery(world, rapier, body, lastSafe.current) ||
        findCharacterRecovery(world, rapier, body, PLAYER_SPAWN);
      input.recover = false;
      if (!recovery) return;
      body.setTranslation(recovery, true);
      body.setNextKinematicTranslation(recovery);
      velocity.current = { x: 0, y: 0, z: 0 };
      input.knockback = { x: 0, z: 0 };
      lastSafe.current = { ...recovery };
      state.setPlayerPosition(recovery);
      state.setTelemetry(0, 0);
      input.jump = false;
      state.setNotice("BACK ON SOLID GROUND");
      input.recover = false;
      return;
    }
    const keys = input.keys;
    input.knockback.x *= Math.exp(-5 * PHYSICS_STEP);
    input.knockback.z *= Math.exp(-5 * PHYSICS_STEP);
    let forward =
      Number(keys.has("KeyW") || keys.has("ArrowUp")) -
      Number(keys.has("KeyS") || keys.has("ArrowDown"));
    let right =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const length = Math.hypot(forward, right);
    if (length) {
      forward /= length;
      right /= length;
    }
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 6.5 : 3.6;
    const targetX =
      (Math.sin(input.yaw) * forward - Math.cos(input.yaw) * right) * speed;
    const targetZ =
      (Math.cos(input.yaw) * forward + Math.sin(input.yaw) * right) * speed;
    const grounded = character.computedGrounded();
    const blend = 1 - Math.exp(-(grounded ? 14 : 4) * PHYSICS_STEP);
    velocity.current.x += (targetX - velocity.current.x) * blend;
    velocity.current.z += (targetZ - velocity.current.z) * blend;
    velocity.current.y =
      grounded && velocity.current.y < 0
        ? -0.5
        : Math.max(-25, velocity.current.y - 18 * PHYSICS_STEP);
    if (input.jump && grounded) velocity.current.y = 6.5;
    input.jump = false;
    character.computeColliderMovement(
      collider.current,
      {
        x: (velocity.current.x + input.knockback.x) * PHYSICS_STEP,
        y: velocity.current.y * PHYSICS_STEP,
        z: (velocity.current.z + input.knockback.z) * PHYSICS_STEP,
      },
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const move = character.computedMovement();
    body.setNextKinematicTranslation({
      x: p.x + move.x,
      y: p.y + move.y,
      z: p.z + move.z,
    });
    if (character.computedGrounded() && velocity.current.y < 0)
      velocity.current.y = 0;
    animation.current.speed = Math.hypot(move.x, move.z) / PHYSICS_STEP;
    if (animation.current.speed > 0.15)
      animation.current.heading = Math.atan2(move.x, move.z);
    timer.current += PHYSICS_STEP;
    if (timer.current > 0.1) {
      timer.current = 0;
      if (
        character.computedGrounded() &&
        !hasLostTerrainSupport(body.translation(), 0.5)
      )
        lastSafe.current = { ...body.translation() };
      state.setPlayerPosition(body.translation());
      state.setPlayerHeading(animation.current.heading);
      state.setTelemetry(animation.current.speed, 0);
    }
  });
  return (
    <RigidBody
      ref={playerBody}
      type="kinematicPosition"
      position={[PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z]}
      colliders={false}
      userData={{ kind: "player" }}
    >
      <CapsuleCollider
        ref={collider}
        args={[0.5, 0.3]}
        friction={0}
        restitution={0}
      />
      <group visible={walking}>
        <Humanoid animation={animation} />
      </group>
    </RigidBody>
  );
}

function Interactions({ controls, registry, playerBody }) {
  const timer = useRef(0);
  const { world, rapier } = useRapier();
  useBeforePhysicsStep(() => {
    const state = useGameStore.getState(),
      input = controls.current;
    const player = playerBody.current;
    if (!player) return;
    timer.current += PHYSICS_STEP;
    let nearest = null,
      nearestDistance = HIJACK_DISTANCE;
    if (
      state.mode === GAME_MODES.WALKING &&
      (timer.current >= 0.1 || input.interact)
    ) {
      const position = player.translation();
      for (const [id, entry] of registry.current) {
        if (!entry.body.isEnabled()) continue;
        const p = entry.body.translation();
        const distance = Math.hypot(
          p.x - position.x,
          p.y - position.y,
          p.z - position.z,
        );
        if (
          distance <= nearestDistance &&
          hasVehicleAccess(world, rapier, player, entry.body)
        ) {
          nearest = id;
          nearestDistance = distance;
        }
      }
      state.setNearbyVehicle(nearest);
      timer.current = 0;
    }
    if (!input.interact) return;
    input.interact = false;
    input.jump = false;
    if (state.mode === GAME_MODES.WALKING) {
      if (!nearest) {
        state.setNotice("GET CLOSER TO A CAR");
        return;
      }
      const entry = registry.current.get(nearest);
      state.setPlayerPosition(player.translation());
      state.updateVehiclePose(
        nearest,
        entry.body.translation(),
        headingFromRotation(entry.body.rotation()),
      );
      const hijacked = useGameStore.getState().vehicles[nearest].hasNpcDriver;
      if (useGameStore.getState().enterVehicle(nearest)) {
        input.knockback = { x: 0, z: 0 };
        player.setEnabled(false);
        entry.body.wakeUp();
        input.orbit = 0;
        state.setNearbyVehicle(null);
        if (hijacked) state.addScore(50);
        state.setNotice(
          hijacked ? "YOUR RIDE NOW  +50" : "SUNSET GT. MAKE IT YOURS.",
        );
        playHijack();
        startEngine();
      }
    } else {
      const entry = registry.current.get(state.activeVehicleId);
      if (!entry) return;
      const safe = findSafeExit(world, rapier, entry.body);
      if (!safe) {
        state.setNotice(
          state.speed > 9
            ? "BRAKE BEFORE EXITING"
            : "NO CLEAR EXIT. MOVE THE CAR.",
        );
        return;
      }
      if (state.exitVehicle(safe)) {
        player.setTranslation(safe, true);
        player.setNextKinematicTranslation(safe);
        player.setEnabled(true);
        input.yaw = headingFromRotation(entry.body.rotation());
        input.orbit = 0;
        state.setTelemetry(0, 0);
        stopEngine();
        playSqueal(false);
      }
    }
  });
  return null;
}

function CameraRig({ controls, registry, playerBody }) {
  const { world, rapier, rigidBodyStates } = useRapier();
  const { camera, gl } = useThree();
  const target = useMemo(() => new Vector3(), []);
  const desired = useMemo(() => new Vector3(), []);
  const look = useMemo(() => new Vector3(), []);
  const initialized = useRef(false);
  const cameraYaw = useRef(Math.PI);
  const renderPosition = useMemo(() => new Vector3(), []);
  const renderRotation = useMemo(() => new Quaternion(), []);
  const previousTarget = useMemo(() => new Vector3(), []);
  useEffect(() => {
    const canvas = gl.domElement;
    let dragging = false,
      x = 0,
      y = 0;
    const down = (event) => {
      dragging = true;
      x = event.clientX;
      y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event) => {
      if (!dragging || useGameStore.getState().paused) return;
      const input = controls.current,
        dx = event.clientX - x,
        dy = event.clientY - y;
      x = event.clientX;
      y = event.clientY;
      if (useGameStore.getState().mode === GAME_MODES.DRIVING) {
        input.orbit -= dx * 0.005;
        input.orbitTime = performance.now();
      } else input.yaw -= dx * 0.005;
      input.pitch = clamp(input.pitch + dy * 0.003, 0.16, 0.85);
    };
    const up = () => {
      dragging = false;
    };
    const wheel = (event) => {
      event.preventDefault();
      controls.current.zoom = clamp(
        controls.current.zoom + event.deltaY * 0.001,
        0.65,
        1.8,
      );
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [gl, controls]);
  useFrame((_, dt) => {
    const state = useGameStore.getState();
    const active = registry.current.get(state.activeVehicleId);
    const body = active?.body || playerBody.current;
    if (!body) return;
    if (state.paused) return;
    const rendered = rigidBodyStates.get(body.handle)?.object;
    const p = rendered
      ? rendered.getWorldPosition(renderPosition)
      : body.translation();
    const rotation = rendered
      ? rendered.getWorldQuaternion(renderRotation)
      : body.rotation();
    const input = controls.current,
      driving = Boolean(active);
    const frameDelta = Math.min(dt, 0.05);
    if (driving && performance.now() - input.orbitTime > 1800)
      input.orbit *= Math.exp(-frameDelta * 2);
    const yaw = driving
      ? headingFromRotation(rotation) + input.orbit
      : input.yaw;
    cameraYaw.current +=
      angleDelta(yaw, cameraYaw.current) * (1 - Math.exp(-frameDelta * 8));
    const distance = (driving ? 8 + state.speed * 0.015 : 6) * input.zoom;
    const velocity = driving ? body.linvel() : { x: 0, z: 0 };
    target.set(
      p.x + velocity.x * 0.12,
      p.y + (driving ? 0.9 : 0.45),
      p.z + velocity.z * 0.12,
    );
    desired.set(
      target.x - Math.sin(cameraYaw.current) * distance,
      target.y + distance * input.pitch,
      target.z - Math.cos(cameraYaw.current) * distance,
    );
    desired.copy(cameraClearance(world, rapier, target, desired));
    const teleported =
      initialized.current && previousTarget.distanceTo(target) > 18;
    if (!initialized.current || teleported) {
      camera.position.copy(desired);
      look.copy(target);
      initialized.current = true;
      cameraYaw.current = yaw;
    }
    previousTarget.copy(target);
    const blend = 1 - Math.exp(-frameDelta * 7);
    camera.position.lerp(desired, blend);
    camera.position.copy(
      cameraClearance(world, rapier, target, camera.position),
    );
    look.lerp(target, 1 - Math.exp(-frameDelta * 12));
    camera.lookAt(look);
    const fov = driving
      ? 52 + Math.min(state.speed * 0.08, 8) + (state.boosting ? 3 : 0)
      : 50;
    if (Math.abs(camera.fov - fov) > 0.02) {
      camera.fov += (fov - camera.fov) * blend;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function Checkpoint({ registry }) {
  const root = useRef();
  const ground = useRef(0);
  const sampledIndex = useRef(-1);
  const { world, rapier } = useRapier();
  const index = useGameStore((s) => s.checkpointIndex);
  const ring = useRef();
  const lastCollected = useRef(-10);
  const checkpoint = CHECKPOINTS[index];
  useBeforePhysicsStep(() => {
    if (sampledIndex.current === index) return;
    const hit = world.castRay(
      new rapier.Ray(
        { x: checkpoint.x, y: 80, z: checkpoint.z },
        { x: 0, y: -1, z: 0 },
      ),
      100,
      true,
      rapier.QueryFilterFlags.EXCLUDE_DYNAMIC |
        rapier.QueryFilterFlags.EXCLUDE_KINEMATIC |
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    if (hit && root.current) {
      ground.current = 80 - hit.timeOfImpact;
      root.current.position.y = ground.current + 0.04;
      sampledIndex.current = index;
    }
  });
  useFrame(({ clock }, dt) => {
    const state = useGameStore.getState();
    if (state.paused) return;
    if (ring.current) {
      ring.current.rotation.y += dt * 0.6;
      ring.current.position.y = 2 + Math.sin(clock.elapsedTime * 2) * 0.15;
    }
    if (
      state.mode === GAME_MODES.DRIVING &&
      distance2D(
        registry.current.get(state.activeVehicleId)?.body.translation() ||
          state.playerPosition,
        checkpoint,
      ) < 3.2 &&
      Math.abs(state.playerPosition.y - ground.current) < 3 &&
      clock.elapsedTime - lastCollected.current > 1.5
    ) {
      lastCollected.current = clock.elapsedTime;
      const wasFinished = state.checkpointIndex + 1 >= CHECKPOINTS.length;
      state.completeCheckpoint(CHECKPOINTS.length);
      playCheckpoint(wasFinished);
    }
  });
  return (
    <group ref={root} position={[checkpoint.x, 0, checkpoint.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]}>
        <ringGeometry args={[2.3, 2.45, 48]} />
        <meshBasicMaterial color="#ffd17c" />
      </mesh>
      <group ref={ring} position={[0, 2, 0]}>
        <mesh>
          <torusGeometry args={[1.6, 0.055, 6, 40]} />
          <meshBasicMaterial color="#ffda8a" />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.5]} />
          <meshStandardMaterial
            color="#ffd58a"
            metalness={0.5}
            roughness={0.25}
            emissive="#eaa857"
            emissiveIntensity={0.4}
          />
        </mesh>
      </group>
      <mesh position={[0, 9, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 18, 6]} />
        <meshBasicMaterial
          color="#ffe3a3"
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function World({ controls, mobile }) {
  const traffic = useMemo(
    () =>
      mobile
        ? [
            TRAFFIC[0],
            ...sampleEvenly(TRAFFIC.slice(1), MOBILE_LIMITS.cars - 1),
          ]
        : TRAFFIC,
    [mobile],
  );
  const registry = useRef(new Map());
  const playerBody = useRef();
  const prevDriving = useRef(false);
  const timerTick = useRef(0);
  useBeforePhysicsStep(() => {
    timerTick.current += PHYSICS_STEP;
    if (timerTick.current >= 0.1) {
      useGameStore.getState().tickLapTimer(timerTick.current);
      timerTick.current = 0;
    }
  });
  useFrame(() => {
    const state = useGameStore.getState();
    const driving = state.mode === GAME_MODES.DRIVING;
    // Engine sound lifecycle – start/stop only on mode transition
    if (driving && !prevDriving.current) startEngine();
    if (!driving && prevDriving.current) {
      stopEngine();
      playSqueal(false);
    }
    prevDriving.current = driving;
  });
  useEffect(() => {
    useGameStore.getState().setWorldReady(true);
  }, []);
  return (
    <>
      <City />
      <Terrain />
      {traffic.map((config) => (
        <Vehicle
          key={config.id}
          config={config}
          controls={controls}
          mobile={mobile}
          registry={registry}
        />
      ))}
      <NPC mobile={mobile} />
      <Player controls={controls} playerBody={playerBody} />
      <Interactions
        controls={controls}
        registry={registry}
        playerBody={playerBody}
      />
      <CameraRig
        controls={controls}
        registry={registry}
        playerBody={playerBody}
      />
      <Checkpoint registry={registry} />
      {!mobile && <CarHeadlights registry={registry} />}
    </>
  );
}

// ─── Night Intensity Helper ───────────────────────────────────────────────
// Returns 0 (full day) → 1 (full night), smooth transition at dusk/dawn
function getNightIntensity(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 19) return 0; // daytime
  if (h >= 19 && h < 21) return (h - 19) / 2; // dusk  19→21
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2; // dawn  5→7
  return 1; // full night
}

// ─── Car Headlights ───────────────────────────────────────────────────────
function CarHeadlights({ registry }) {
  const leftRef = useRef();
  const rightRef = useRef();
  const tailRef = useRef();

  useFrame(() => {
    const store = useGameStore.getState();
    const nightI = getNightIntensity(store.gameHour ?? 17);
    const driving = store.mode === GAME_MODES.DRIVING;
    const entry = driving ? registry.current.get(store.activeVehicleId) : null;
    const vehicle = entry
      ? {
          position: entry.body.translation(),
          heading: headingFromRotation(entry.body.rotation()),
        }
      : null;

    const offI = 0;
    if (!vehicle?.position || nightI < 0.02) {
      if (leftRef.current) leftRef.current.intensity = offI;
      if (rightRef.current) rightRef.current.intensity = offI;
      if (tailRef.current) tailRef.current.intensity = offI;
      return;
    }

    const heading = vehicle.heading ?? 0;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const fwdX = sin * 3.2,
      fwdZ = cos * 3.2;
    const rgtX = cos * 1.1,
      rgtZ = -sin * 1.1;
    const py = (vehicle.position.y ?? 0) + 0.65;
    const px = vehicle.position.x;
    const pz = vehicle.position.z;

    // Left headlight
    if (leftRef.current) {
      leftRef.current.position.set(px + fwdX + rgtX, py, pz + fwdZ + rgtZ);
      leftRef.current.intensity = nightI * 22;
    }
    // Right headlight
    if (rightRef.current) {
      rightRef.current.position.set(px + fwdX - rgtX, py, pz + fwdZ - rgtZ);
      rightRef.current.intensity = nightI * 22;
    }
    // Taillight
    if (tailRef.current) {
      tailRef.current.position.set(
        px - fwdX * 0.75,
        py - 0.1,
        pz - fwdZ * 0.75,
      );
      tailRef.current.intensity = nightI * 6;
    }
  });

  return (
    <>
      <pointLight
        ref={leftRef}
        color="#fff8dd"
        distance={45}
        decay={2}
        intensity={0}
      />
      <pointLight
        ref={rightRef}
        color="#fff8dd"
        distance={45}
        decay={2}
        intensity={0}
      />
      <pointLight
        ref={tailRef}
        color="#ff2200"
        distance={10}
        decay={2}
        intensity={0}
      />
    </>
  );
}

// ─── Day / Night Lighting ─────────────────────────────────────────────────
// The optional cycle advances one in-game hour every 90 seconds.
const DAY_SPEED = 1 / 90; // in-game hours per real second

// Keyframes: [hour, skyHex, fogHex, sunColorHex, sunIntensity, ambientIntensity, hemiSkyHex, hemiGroundHex]
const SKY_KEYS = [
  [0, "#0a1220", "#0d1a2a", "#3060a0", 0.3, 0.05, "#1a2848", "#141418"],
  [5, "#1c2e50", "#243050", "#e07050", 0.8, 0.1, "#3a4868", "#282830"],
  [7, "#b6cdc7", "#a0bdc7", "#ffd090", 2.0, 0.2, "#c5dde7", "#607a70"],
  [10, "#c8dde8", "#b6cdc7", "#ffe0b1", 3.0, 0.25, "#d9ede7", "#798274"],
  [17, "#d4a06a", "#c4956a", "#ffa040", 2.8, 0.22, "#d4b88a", "#706a50"],
  [20, "#2a1830", "#201428", "#cc4040", 0.5, 0.08, "#2a2040", "#241820"],
  [22, "#0a1220", "#0d1a2a", "#3060a0", 0.3, 0.05, "#1a2848", "#141418"],
  [24, "#0a1220", "#0d1a2a", "#3060a0", 0.3, 0.05, "#1a2848", "#141418"],
];

function lerpHex(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16),
    ag = parseInt(a.slice(3, 5), 16),
    ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16),
    bg = parseInt(b.slice(3, 5), 16),
    bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(ag + (bg - ag) * t)
    .toString(16)
    .padStart(2, "0");
  const bh = Math.round(ab + (bb - ab) * t)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${bh}`;
}

function getSkyAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let lo = SKY_KEYS[SKY_KEYS.length - 2],
    hi = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (h >= SKY_KEYS[i][0] && h < SKY_KEYS[i + 1][0]) {
      lo = SKY_KEYS[i];
      hi = SKY_KEYS[i + 1];
      break;
    }
  }
  const t = (h - lo[0]) / (hi[0] - lo[0]);
  return {
    sky: lerpHex(lo[1], hi[1], t),
    fog: lerpHex(lo[2], hi[2], t),
    sun: lerpHex(lo[3], hi[3], t),
    sunI: lo[4] + (hi[4] - lo[4]) * t,
    ambI: lo[5] + (hi[5] - lo[5]) * t,
    hSky: lerpHex(lo[6], hi[6], t),
    hGnd: lerpHex(lo[7], hi[7], t),
  };
}

function DayNightLighting({ lowQuality, lightingMode }) {
  const dirLight = useRef();
  const hemiLight = useRef();
  const ambLight = useRef();
  const gameTime = useRef(17);
  const publishTime = useRef(0); // start at golden hour

  useFrame((state, dt) => {
    if (useGameStore.getState().paused) return;
    if (lightingMode === "cycle")
      gameTime.current =
        (gameTime.current + Math.min(dt, 0.05) * DAY_SPEED) % 24;
    else gameTime.current = lightingMode === "night" ? 22 : 17;
    const t = gameTime.current;
    const s = getSkyAt(t);

    // Sun position: orbits overhead, from east (morning) to west (evening)
    const angle = ((t - 6) / 12) * Math.PI; // 0 at 6am, π at 6pm
    const sunX = -Math.cos(angle) * 60;
    const sunY = Math.sin(angle) * 80;
    const sunZ = 30;

    if (dirLight.current) {
      dirLight.current.position.set(sunX, Math.max(sunY, 35), sunZ);
      dirLight.current.color.set(s.sun);
      dirLight.current.intensity = s.sunI;
    }
    if (hemiLight.current) {
      hemiLight.current.color.set(s.hSky);
      hemiLight.current.groundColor.set(s.hGnd);
    }
    if (ambLight.current) {
      ambLight.current.intensity = Math.max(s.ambI, 0.48);
    }
    state.scene.background?.set(s.sky);
    state.scene.fog?.color.set(s.fog);

    // Publish shared lighting snapshots at a limited rate for building glow.
    publishTime.current += dt;
    if (publishTime.current < 0.15) return;
    publishTime.current = 0;
    useGameStore.getState().setGameHour(t);
    // Update HUD world time (string, ~1 update per in-game minute)
    const rounded = Math.floor(t);
    const mins = Math.floor((t % 1) * 60);
    useGameStore
      .getState()
      .setWorldTime(
        `${String(rounded).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
      );
  });

  return (
    <>
      <color attach="background" args={["#b6cdc7"]} />
      <fog attach="fog" args={["#b6cdc7", 90, 420]} />
      <hemisphereLight ref={hemiLight} args={["#d9ede7", "#798274", 1.8]} />
      <ambientLight ref={ambLight} intensity={0.25} />
      <directionalLight
        ref={dirLight}
        position={[-45, 65, 35]}
        intensity={3}
        color="#ffe0b1"
        castShadow={!lowQuality}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-near={1}
        shadow-camera-far={180}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
      />
    </>
  );
}

// ─── Detect mobile device ──────────────────────────────────────────────────
const isMobileDevice = () =>
  window.matchMedia("(pointer: coarse)").matches ||
  navigator.maxTouchPoints > 0;

// Haptic helper — safe no-op on desktop
const vibrate = (ms) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* Haptics are optional. */
  }
};

// ─── Portrait Overlay ──────────────────────────────────────────────────────
function PortraitOverlay() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (!isMobileDevice()) return;
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  if (!portrait) return null;
  return (
    <div className="portrait-overlay">
      <div className="portrait-icon">⟳</div>
      <p>
        Rotate your phone
        <br />
        <strong>landscape</strong> for best experience
      </p>
    </div>
  );
}

// ─── Touch Controls (Floating Joystick) ────────────────────────────────────
function BoostButton({ bindings }) {
  const charge = useGameStore((s) => s.nitroCharge);
  const boosting = useGameStore((s) => s.boosting);
  return (
    <button
      className={`touch-btn touch-btn-boost${boosting ? " is-boosting" : ""}`}
      style={{ "--nitro-charge": `${charge * 100}%` }}
      aria-label={`Hold for nitro boost, ${Math.round(charge * 100)} percent charge`}
      {...bindings}
    >
      BOOST
    </button>
  );
}

function TouchPad({ controls }) {
  const driving = useGameStore((s) => s.mode === GAME_MODES.DRIVING);
  const paused = useGameStore((s) => s.paused);

  // Joystick state
  const joyOriginRef = useRef(null); // { x, y, pageX, pageY } where touch started
  const joyTouchId = useRef(null);
  const joyThumb = useRef(null);
  const [joyState, setJoyState] = useState(null); // { ox, oy, tx, ty } for rendering

  const JOY_R = 52; // ring radius px — thumb max travel

  const onJoyStart = (e) => {
    if (paused || joyTouchId.current !== null) return;
    const t = e.changedTouches[0];
    joyOriginRef.current = { x: t.clientX, y: t.clientY };
    joyTouchId.current = t.identifier;
    setJoyState({ ox: t.clientX, oy: t.clientY, tx: t.clientX, ty: t.clientY });
  };

  const onJoyMove = (e) => {
    if (!joyOriginRef.current) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== joyTouchId.current) continue;
      const dx = t.clientX - joyOriginRef.current.x;
      const dy = t.clientY - joyOriginRef.current.y;
      // Clamp thumb within ring
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, JOY_R);
      const cx = (dx / len) * clamped;
      const cy = (dy / len) * clamped;
      if (joyThumb.current)
        joyThumb.current.style.transform = `translate(${cx}px, ${cy}px)`;

      // Update virtual keys
      const dead = 12;
      const keys = controls.current.keys;
      keys.delete("KeyW");
      keys.delete("KeyS");
      keys.delete("KeyA");
      keys.delete("KeyD");
      if (dy < -dead) keys.add("KeyW");
      if (dy > dead) keys.add("KeyS");
      if (dx < -dead) keys.add("KeyA");
      if (dx > dead) keys.add("KeyD");
    }
  };

  const onJoyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyTouchId.current) continue;
      joyOriginRef.current = null;
      joyTouchId.current = null;
      setJoyState(null);
      const keys = controls.current.keys;
      keys.delete("KeyW");
      keys.delete("KeyS");
      keys.delete("KeyA");
      keys.delete("KeyD");
    }
  };

  // Button helper with haptics
  const btn = (key, flags = {}) => ({
    onTouchStart: (e) => {
      e.preventDefault();
      if (paused) return;
      vibrate(18);
      controls.current.keys.add(key);
      if (flags.interact) controls.current.interact = true;
      if (flags.jump) controls.current.jump = true;
      if (flags.recover) controls.current.recover = true;
    },
    onTouchEnd: (e) => {
      e.preventDefault();
      controls.current.keys.delete(key);
    },
    onTouchCancel: () => {
      controls.current.keys.delete(key);
    },
  });

  return (
    <div className="touch-hud" aria-hidden="true">
      {/* Full-left zone: touch anywhere in left half to spawn floating joystick */}
      <div
        className="touch-joy-zone"
        onTouchStart={onJoyStart}
        onTouchMove={onJoyMove}
        onTouchEnd={onJoyEnd}
        onTouchCancel={onJoyEnd}
      >
        {joyState && (
          <div
            className="touch-joy-floating"
            style={{ left: joyState.ox, top: joyState.oy }}
          >
            {/* Outer ring */}
            <div className="touch-joy-ring" />
            {/* Thumb knob — moves with finger */}
            <div
              ref={joyThumb}
              className="touch-joy-thumb"
              style={{
                transform: `translate(${joyState.tx - joyState.ox}px, ${joyState.ty - joyState.oy}px)`,
              }}
            />
          </div>
        )}
        {/* Hint when no touch active */}
        {!joyState && <div className="touch-joy-hint">MOVE</div>}
      </div>

      {/* Right: Action buttons */}
      <div className={`touch-btns${driving ? " touch-btns--driving" : ""}`}>
        <button
          className="touch-btn touch-btn-e"
          {...btn("KeyE", { interact: true })}
        >
          {driving ? "EXIT" : "ENTER"}
        </button>

        {driving ? (
          <>
            <BoostButton bindings={btn("ShiftLeft")} />
            <button className="touch-btn touch-btn-space" {...btn("Space")}>
              ⟳ HB
            </button>
            <button className="touch-btn touch-btn-b" {...btn("KeyB")}>
              BRAKE
            </button>
            <button
              className="touch-btn touch-btn-r"
              {...btn("KeyR", { recover: true })}
            >
              ↺
            </button>
          </>
        ) : (
          <>
            <button
              className="touch-btn touch-btn-space"
              {...btn("Space", { jump: true })}
            >
              JUMP
            </button>
            <button className="touch-btn touch-btn-shift" {...btn("ShiftLeft")}>
              RUN
            </button>
            <button
              className="touch-btn touch-btn-r"
              {...btn("KeyR", { recover: true })}
            >
              ↺
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const controls = useRef(createControls());
  const [mobile] = useState(
    () =>
      isMobileDevice() ||
      new URLSearchParams(window.location.search).has("mobile"),
  );
  // Auto-enable Lite mode on mobile for 30+ fps on mid-range phones
  const [lowQuality, setLowQuality] = useState(() => mobile);
  const [debug, setDebug] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [lightingMode, setLightingMode] = useState("sunset");
  const paused = useGameStore((s) => s.paused);
  useEffect(() => {
    setAudioPaused(paused);
  }, [paused]);
  useEffect(() => {
    const reserved = [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ];
    const down = (event) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches("input, select, textarea") ||
          (event.target.matches("button") &&
            ["Enter", "Space"].includes(event.code)))
      )
        return;
      if (reserved.includes(event.code)) event.preventDefault();
      if (event.code === "Escape" && !event.repeat) {
        useGameStore.getState().setPaused(!useGameStore.getState().paused);
        controls.current.keys.clear();
        controls.current.interact = false;
        controls.current.jump = false;
        controls.current.recover = false;
        setShowHelp(false);
        return;
      }
      if (event.code === "KeyH" && !event.repeat) {
        const opening = !useGameStore.getState().paused;
        setShowHelp(opening);
        useGameStore.getState().setPaused(opening);
        controls.current.keys.clear();
        return;
      }
      if (event.code === "F3" && !event.repeat) {
        event.preventDefault();
        setDebug((value) => !value);
        return;
      }
      if (useGameStore.getState().paused || !useGameStore.getState().worldReady)
        return;
      controls.current.keys.add(event.code);
      if (!event.repeat) {
        if (event.code === "KeyE") controls.current.interact = true;
        if (event.code === "Space") controls.current.jump = true;
        if (event.code === "KeyR") controls.current.recover = true;
      }
    };
    const up = (event) => controls.current.keys.delete(event.code);
    const blur = () => {
      controls.current.keys.clear();
      controls.current.interact = false;
      controls.current.jump = false;
      useGameStore.getState().setPaused(true);
    };
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return (
    <main className="game-shell">
      <GameBoundary>
        <Canvas
          // PCF ("soft") shadows cost a fraction of PCFSoft ("percentage")
          // taps; at 1.25 dpr the fill rate drops ~30% vs 1.5 on weak GPUs.
          frameloop="never"
          shadows={lowQuality || mobile ? false : "percentage"}
          dpr={mobile ? MOBILE_LIMITS.dpr : lowQuality ? 1 : [1, 1.25]}
          camera={{ position: [5.2, 4.5, 15], fov: 50, near: 0.1, far: 600 }}
          gl={{
            antialias: !mobile,
            alpha: false,
            stencil: false,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.05;
            gl.domElement.setAttribute(
              "aria-label",
              "Sunset District interactive 3D world",
            );
            gl.domElement.setAttribute("tabindex", "0");
          }}
        >
          <FrameClock />
          <DayNightLighting
            lowQuality={lowQuality || mobile}
            lightingMode={lightingMode}
          />
          <Suspense fallback={null}>
            <Physics
              gravity={[0, -9.81, 0]}
              timeStep={PHYSICS_STEP}
              interpolate
              paused={paused}
              debug={debug}
              numSolverIterations={6}
            >
              <World controls={controls} mobile={mobile} />
            </Physics>
          </Suspense>
        </Canvas>
      </GameBoundary>
      <HUD
        lowQuality={lowQuality}
        setLowQuality={setLowQuality}
        debug={debug}
        setDebug={setDebug}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        lightingMode={lightingMode}
        setLightingMode={setLightingMode}
      />
      <TouchPad controls={controls} />
      <PortraitOverlay />
    </main>
  );
}
