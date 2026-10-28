import { create } from "zustand";

export const GAME_MODES = Object.freeze({
  WALKING: "walking",
  DRIVING: "driving",
});
export const HIJACK_DISTANCE = 3;
export const PLAYER_SPAWN = Object.freeze({ x: 5.2, y: 1.1, z: 8 });

const isPosition = (value) =>
  value != null && [value.x, value.y, value.z].every(Number.isFinite);

const copyPosition = ({ x, y, z }) => ({ x, y, z });
const samePosition = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

const initialState = () => ({
  playerPosition: { ...PLAYER_SPAWN },
  playerHeading: Math.PI,
  mode: GAME_MODES.WALKING,
  activeVehicleId: null,
  score: 0,
  vehicles: {},
  paused: false,
  speed: 0,
  groundedWheels: 0,
  boosting: false,
  nitroCharge: 1,
  nearbyVehicleId: null,
  notice: "",
  checkpointIndex: 0,
  laps: 0,
  worldReady: false,
  fps: 60,
  lapStartTime: null,
  currentLapTime: 0,
  bestLap: null,
  worldTime: "17:00",
  gameHour: 17, // float 0-24, updated every frame for smooth night lerp
});

// Keep Rapier bodies and animation refs in components. Publish position snapshots
// at about 10 Hz for UI; synchronize live poses before attempting an interaction.
// Subscribe to individual fields so moving entities do not rerender the world.
export const useGameStore = create((set, get) => ({
  ...initialState(),
  setWorldReady: (worldReady) => set({ worldReady }),
  setPlayerHeading: (heading) => {
    if (Number.isFinite(heading) && get().playerHeading !== heading)
      set({ playerHeading: heading });
  },
  setWorldTime: (worldTime) => {
    if (get().worldTime !== worldTime) set({ worldTime });
  },
  // Lighting snapshots are published at a limited rate by the scene.
  setGameHour: (h) => set({ gameHour: h }),
  setFps: (fps) => {
    if (get().fps !== fps) set({ fps });
  },

  setPaused: (paused) => set({ paused }),
  setNitro: (charge, boosting) => {
    if (!Number.isFinite(charge)) return;
    const nitroCharge =
      Math.round(Math.max(0, Math.min(1, charge)) * 100) / 100;
    if (
      get().nitroCharge !== nitroCharge ||
      get().boosting !== Boolean(boosting)
    )
      set({ nitroCharge, boosting: Boolean(boosting) });
  },
  setNotice: (notice) => set({ notice }),
  setNearbyVehicle: (id) => {
    if (get().nearbyVehicleId !== id) set({ nearbyVehicleId: id });
  },
  setTelemetry: (speed, groundedWheels) => {
    if (!Number.isFinite(speed)) return;
    const rounded = Math.round(Math.abs(speed) * 3.6);
    if (get().speed !== rounded || get().groundedWheels !== groundedWheels) {
      set({ speed: rounded, groundedWheels });
    }
  },
  completeCheckpoint: (total) => {
    if (!Number.isInteger(total) || total <= 0) return;
    set((state) => {
      const finished = state.checkpointIndex + 1 >= total;
      const lapTime =
        finished && state.lapStartTime != null ? state.currentLapTime : null;
      const bestLap =
        lapTime != null
          ? state.bestLap == null
            ? lapTime
            : Math.min(state.bestLap, lapTime)
          : state.bestLap;
      const isNewBest =
        lapTime != null &&
        bestLap === lapTime &&
        state.bestLap != null &&
        lapTime < state.bestLap;
      return {
        checkpointIndex: finished ? 0 : state.checkpointIndex + 1,
        laps: state.laps + Number(finished),
        score: state.score + (finished ? 600 : 100),
        notice: finished
          ? isNewBest
            ? `NEW BEST  ${lapTime.toFixed(1)}s  +600`
            : lapTime != null
              ? `CIRCUIT  ${lapTime.toFixed(1)}s  +600`
              : "CIRCUIT COMPLETE  +600"
          : "CHECKPOINT  +100",
        lapStartTime: 0,
        bestLap,
        currentLapTime: finished ? 0 : state.currentLapTime,
      };
    });
  },

  tickLapTimer: (delta) => {
    const state = get();
    if (
      state.lapStartTime == null ||
      state.paused ||
      state.mode !== GAME_MODES.DRIVING ||
      !Number.isFinite(delta) ||
      delta <= 0
    )
      return;
    set({ currentLapTime: state.currentLapTime + delta });
  },

  setPlayerPosition: (position) => {
    if (!isPosition(position) || samePosition(get().playerPosition, position))
      return;
    set({ playerPosition: copyPosition(position) });
  },

  addScore: (points) => {
    if (!Number.isFinite(points) || points <= 0) return;
    set((state) => ({ score: state.score + points }));
  },

  // Heading is in radians. Traffic components will own their fixed routes.
  registerVehicle: ({ id, position, heading = 0, isTraffic = true }) => {
    if (
      typeof id !== "string" ||
      !id.trim() ||
      !isPosition(position) ||
      !Number.isFinite(heading) ||
      Object.hasOwn(get().vehicles, id)
    )
      return false;

    set((state) => ({
      vehicles: {
        ...state.vehicles,
        [id]: {
          id,
          position: copyPosition(position),
          heading,
          autoDrive: Boolean(isTraffic),
          hasNpcDriver: Boolean(isTraffic),
        },
      },
    }));
    return true;
  },

  updateVehiclePose: (id, position, heading) => {
    const vehicle = get().vehicles[id];
    if (!Object.hasOwn(get().vehicles, id) || !isPosition(position)) return;
    const nextHeading = heading ?? vehicle.heading;
    if (!Number.isFinite(nextHeading)) return;
    if (
      samePosition(vehicle.position, position) &&
      vehicle.heading === nextHeading
    )
      return;

    set((state) => ({
      vehicles: {
        ...state.vehicles,
        [id]: {
          ...state.vehicles[id],
          position: copyPosition(position),
          heading: nextHeading,
        },
      },
    }));
  },

  // E-key input belongs in the entity component. This atomic transition makes
  // the driver mesh disappear and hands control from traffic to the player.
  enterVehicle: (id) => {
    const state = get();
    if (state.mode !== GAME_MODES.WALKING || !Object.hasOwn(state.vehicles, id))
      return false;

    const vehicle = state.vehicles[id];
    const dx = state.playerPosition.x - vehicle.position.x;
    const dy = state.playerPosition.y - vehicle.position.y;
    const dz = state.playerPosition.z - vehicle.position.z;
    if (dx * dx + dy * dy + dz * dz > HIJACK_DISTANCE ** 2) return false;

    set({
      mode: GAME_MODES.DRIVING,
      lapStartTime: state.lapStartTime ?? 0,
      activeVehicleId: id,
      playerPosition: copyPosition(vehicle.position),
      vehicles: {
        ...state.vehicles,
        [id]: { ...vehicle, autoDrive: false, hasNpcDriver: false },
      },
    });
    return true;
  },

  // The controller must supply a safe exit point from the live vehicle pose.
  // A hijacked car remains parked after exit; its NPC driver does not respawn.
  exitVehicle: (position) => {
    if (get().mode !== GAME_MODES.DRIVING || !isPosition(position))
      return false;
    set({
      mode: GAME_MODES.WALKING,
      activeVehicleId: null,
      boosting: false,
      playerPosition: copyPosition(position),
    });
    return true;
  },

  removeVehicle: (id) => {
    const state = get();
    if (!Object.hasOwn(state.vehicles, id)) return;
    const vehicles = { ...state.vehicles };
    delete vehicles[id];

    set(
      state.activeVehicleId === id
        ? {
            vehicles,
            mode: GAME_MODES.WALKING,
            activeVehicleId: null,
            playerPosition: copyPosition(state.vehicles[id].position),
          }
        : { vehicles },
    );
  },

  resetGame: () => set(initialState()),
}));
