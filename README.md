# Sunset District

A playable open-world browser sandbox built with Vite, React Three Fiber, Three.js,
Rapier and Zustand. The core game is implemented; it is no longer the Vite starter.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, normally http://localhost:5173.

## Controls

| Input               | Action                                        |
| ------------------- | --------------------------------------------- |
| WASD / arrow keys   | Walk or drive                                 |
| Shift               | Sprint on foot / hold for nitro while driving |
| Space               | Jump on foot / handbrake while driving        |
| B                   | Service brake                                 |
| E                   | Enter a nearby car / exit after slowing down  |
| R                   | Recover the player or active vehicle          |
| Mouse drag / scroll | Look around / camera distance                 |
| Escape              | Pause / resume                                |
| H                   | Open or close controls                        |
| M / click map       | Toggle nearby streets / world overview        |
| F3                  | Toggle collision debug view                   |

Normal gameplay displays only speed and the map. Graphics and lighting settings
are available in the Escape pause menu. Golden-hour lighting is the default; an
optional day/night cycle and readable night mode are available there.

Hold forward and Shift to use a car's nitro boost (mobile: hold BOOST while
moving the joystick forward). Each car has three seconds of boost and recharges
over six seconds of simulation time. An empty tank must fully recharge. Boost
uses tyre forces, with no thrust in the air, in reverse, while braking or upside
down. Blue exhaust, a wider camera view and cyan speed digits indicate boost;
the mobile button shows charge without adding a separate HUD panel.

Lite mode in the pause menu reduces rendering cost. Follow the golden markers to complete
circuits and earn street score. Pedestrians follow straight sidewalk loops;
traffic follows fixed road lanes. Entering a traffic car removes its driver mesh,
disables automatic driving, and transfers the same physical vehicle to the player.

## Architecture

- `src/store/gameStore.js`: centralized game state and atomic vehicle transitions.
- `src/components/City.jsx`: procedural buildings, roads, scenery and static colliders.
- `src/components/Vehicle.jsx`: dynamic chassis, suspension wheels, traffic and controls.
- `src/components/NPC.jsx`: pedestrian loops with physical capsules and instanced visuals.
- `src/components/HUD.jsx`: minimal speed display, local/overview map and optional pause controls.
- `src/App.jsx`: Canvas, lighting, walking controller, interaction, camera and interface.
- `src/physics.js`: shared, independently tested vehicle and character controllers.
- `src/world.js`: deterministic layout, routes, checkpoints and terrain definitions.
- `src/audio.js`: synthesized sound effects.

## Physics and performance

Physics uses a fixed 60 Hz step with interpolation. Vehicles use a 1100 kg dynamic
chassis and four raycast suspension wheels, rear wheel drive, speed-sensitive
steering, tyre grip, service brakes and a rear handbrake. Continuous collision
detection helps prevent tunnelling. An anti-roll torque assists handling while
leaving pitch and roll physically free.

Walking uses a capsule character controller with slope limits, ground snapping,
curb stepping and jump gravity. Exiting a car requires low speed and a clear
capsule-sized space beside or behind it. Camera queries retract against geometry.

Physics references and input remain outside React state. Position snapshots are
published at roughly 10 Hz. Repeated buildings, pedestrians and vehicle parts use
instanced meshes; physics colliders use simple primitives where practical. Engine,
renderer and interface bundles are separated for caching.

## Verification

```sh
npm test
npm run lint
npm run build
```

Tests cover store transitions, interaction range, suspension stability, acceleration,
braking, reverse, steering, airborne traction, wall collisions, momentum retention,
safe exits, curb climbing and procedural terrain/layout invariants.

This is a primitive-based sandbox foundation. It does not implement complex NPC
pathfinding, police, combat, a damage model, interiors or saved progression.

## Handling and collision refinements

Throttle and service brakes engage progressively. Steering lock reduces at speed;
rear grip recovers gradually after handbrake release. A flat heightfield city floor
prevents the walking capsule from sinking into an oversized cuboid. Traffic spawns
are spaced apart and wrapped only into clear locations. Recovery checks for other
vehicles, entry checks line of sight, and a sphere sweep keeps the camera clear of
walls even after smoothing. Lap timing uses simulated driving time, excluding pause
and time spent on foot. Audio pauses with the simulation.

## Terrain support repairs

Playable hills now use static triangle colliders built from the exact render
geometry, with internal-edge correction. Terrain height queries use the same
triangle interpolation. Region seams share a flat edge, decorative mountains stay
fully outside the playable square, and the visible perimeter fence follows the
ground. Tall perimeter collision and a world-wide safety floor close edge gaps.
The old in-world decorative hill cones and mismatched mesa shell were removed.
Highway and pass-road collision thickness now matches their visible meshes.

Car and character recovery use their last supported local position and query
clear ground before placement. A fall is detected relative to local terrain
height, including hills above sea level. Recovery keeps wilderness coordinates.

Regression tests compare rendered triangles with collision rays across the map,
walk capsules across terrain seams, drive physical cars off road, check elevated
world-boundary impacts, and validate local recovery.

## Next feature stages

1. Weapons and combat: equip/aim/fire, ammunition, health and NPC defeat.
2. Police: wanted level, response, pursuit and escape cooldown.
3. Short story missions tying vehicle theft, delivery and escape together.

These are subsequent stages; this pass addresses the existing terrain gaps first.

## Mobile testing over Wi-Fi

Run `npm run dev` without a localhost-only `--host` override. Vite listens on
`0.0.0.0:5173` and keeps that port fixed. Connect the phone and PC to the same
Wi-Fi, then open `http://<PC-Wi-Fi-IPv4>:5173/` on the phone. Use `ipconfig` to find
the Wi-Fi adapter's IPv4 address; VPN, VMware and WSL addresses are separate.
The desktop can continue using `http://localhost:5173/`.
