import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  GAME_MODES,
  HIJACK_DISTANCE,
  PLAYER_SPAWN,
  useGameStore,
} from "./gameStore.js";

const state = useGameStore.getState;
const origin = { x: 0, y: 1, z: 0 };
const spawn = (id = "traffic-1", position = origin) =>
  state().registerVehicle({ id, position });

beforeEach(() => state().resetGame());

test("hijacking changes mode, removes the driver, and stops traffic atomically", () => {
  spawn();
  state().setPlayerPosition(origin);
  const previousVehicle = state().vehicles["traffic-1"];
  const transitions = [];
  const unsubscribe = useGameStore.subscribe((next) => transitions.push(next));

  assert.equal(state().enterVehicle("traffic-1"), true);
  unsubscribe();

  assert.equal(transitions.length, 1);
  assert.equal(state().mode, GAME_MODES.DRIVING);
  assert.equal(state().activeVehicleId, "traffic-1");
  assert.equal(state().vehicles["traffic-1"].autoDrive, false);
  assert.equal(state().vehicles["traffic-1"].hasNpcDriver, false);
  assert.equal(previousVehicle.autoDrive, true);
  assert.equal(previousVehicle.hasNpcDriver, true);
});

test("only nearby vehicles can be entered, including the distance boundary", () => {
  spawn();
  const previous = state();
  assert.equal(state().enterVehicle("missing"), false);
  assert.equal(state().enterVehicle("traffic-1"), false);
  assert.equal(state(), previous);
  state().setPlayerPosition({ ...origin, x: HIJACK_DISTANCE + 0.01 });
  assert.equal(state().enterVehicle("traffic-1"), false);
  state().setPlayerPosition({ ...origin, x: HIJACK_DISTANCE });
  assert.equal(state().enterVehicle("traffic-1"), true);
});

test("switching cars while driving fails; exiting leaves the car parked", () => {
  spawn();
  spawn("traffic-2");
  state().setPlayerPosition(origin);
  state().enterVehicle("traffic-1");
  assert.equal(state().enterVehicle("traffic-2"), false);
  assert.equal(state().exitVehicle({ x: NaN, y: 1, z: 0 }), false);
  assert.equal(state().exitVehicle({ x: 2, y: 1, z: 0 }), true);
  assert.equal(state().mode, GAME_MODES.WALKING);
  assert.equal(state().activeVehicleId, null);
  assert.equal(state().vehicles["traffic-1"].autoDrive, false);
  assert.equal(state().vehicles["traffic-1"].hasNpcDriver, false);
  assert.deepEqual(state().playerPosition, { x: 2, y: 1, z: 0 });
});

test("position snapshots are copied, reject invalid values, and skip unchanged updates", () => {
  const position = { ...origin };
  spawn("traffic-1", position);
  state().setPlayerPosition(position);
  position.x = 99;
  assert.deepEqual(state().playerPosition, origin);
  assert.deepEqual(state().vehicles["traffic-1"].position, origin);
  const previous = state();
  state().setPlayerPosition(origin);
  state().setPlayerPosition({ x: Infinity, y: 0, z: 0 });
  state().updateVehiclePose("traffic-1", origin);
  assert.equal(state(), previous);
  state().updateVehiclePose("traffic-1", { x: 2, y: 1, z: 0 }, Math.PI);
  assert.equal(state().vehicles["traffic-1"].heading, Math.PI);
  assert.equal(previous.vehicles["traffic-1"].position.x, 0);
});

test("duplicate registration cannot reactivate a hijacked vehicle", () => {
  spawn();
  state().setPlayerPosition(origin);
  state().enterVehicle("traffic-1");
  assert.equal(spawn(), false);
  assert.equal(state().vehicles["traffic-1"].autoDrive, false);
});

test("despawning the active vehicle restores walking at its latest position", () => {
  spawn();
  state().setPlayerPosition(origin);
  state().enterVehicle("traffic-1");
  const position = { x: 10, y: 1, z: 10 };
  state().updateVehiclePose("traffic-1", position);
  state().removeVehicle("traffic-1");
  assert.deepEqual(state().vehicles, {});
  assert.equal(state().activeVehicleId, null);
  assert.equal(state().mode, GAME_MODES.WALKING);
  assert.deepEqual(state().playerPosition, position);
});

test("reset restores clean data and preserves working actions", () => {
  spawn();
  state().addScore(25);
  state().addScore(-10);
  state().addScore(NaN);
  assert.equal(state().score, 25);
  state().resetGame();
  assert.equal(state().score, 0);
  assert.deepEqual(state().vehicles, {});
  assert.deepEqual(state().playerPosition, PLAYER_SPAWN);
  assert.equal(spawn(), true);
});

test("lap time accumulates only simulated driving time and survives intermediate checkpoints", () => {
  spawn();
  state().setPlayerPosition(origin);
  state().enterVehicle("traffic-1");
  state().tickLapTimer(4);
  state().setPaused(true);
  state().tickLapTimer(20);
  assert.equal(state().currentLapTime, 4);
  state().setPaused(false);
  state().completeCheckpoint(2);
  assert.equal(state().currentLapTime, 4);
  state().tickLapTimer(3);
  state().exitVehicle({ x: 2, y: 1, z: 0 });
  state().tickLapTimer(10);
  assert.equal(state().currentLapTime, 7);
  state().setPlayerPosition(origin);
  state().enterVehicle("traffic-1");
  state().completeCheckpoint(2);
  assert.equal(state().bestLap, 7);
  assert.equal(state().currentLapTime, 0);
});
