import { useEffect, useState } from "react";
import { BLOCKS, CHECKPOINTS, ROAD_CENTERS } from "../world.js";
import { useGameStore } from "../store/gameStore.js";

function mapSnapshot() {
  const s = useGameStore.getState();
  return {
    position: s.playerPosition,
    heading: s.playerHeading,
    vehicles: s.vehicles,
    activeId: s.activeVehicleId,
    nearby: s.nearbyVehicleId,
    checkpoint: CHECKPOINTS[s.checkpointIndex],
  };
}

function Minimap() {
  const [snapshot, setSnapshot] = useState(mapSnapshot);
  const [overview, setOverview] = useState(false);
  useEffect(() => {
    // Sample the map instead of subscribing to every traffic car's pose updates.
    const interval = setInterval(() => setSnapshot(mapSnapshot()), 150);
    const key = (event) => {
      if (event.code === "KeyM" && !event.repeat)
        setOverview((value) => !value);
    };
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const {
    position: p,
    heading,
    vehicles,
    activeId,
    nearby,
    checkpoint: cp,
  } = snapshot;
  const half = overview ? 310 : 48;
  const x = overview ? -310 : p.x - half,
    z = overview ? -310 : p.z - half;
  const marker = overview ? 7 : 2.3;
  const goalX = Math.max(
    x + marker * 2,
    Math.min(x + half * 2 - marker * 2, cp.x),
  );
  const goalZ = Math.max(
    z + marker * 2,
    Math.min(z + half * 2 - marker * 2, cp.z),
  );
  return (
    <button
      className="minimap"
      onClick={() => setOverview(!overview)}
      aria-label={overview ? "Show nearby streets" : "Show world map"}
      title="M · Toggle map zoom"
    >
      <svg
        viewBox={`${x} ${z} ${half * 2} ${half * 2}`}
        role="img"
        aria-label="Map with player, nearby cars and next checkpoint"
      >
        <rect x="-320" y="-320" width="640" height="640" fill="#777b56" />
        <rect x="-300" y="-300" width="182" height="600" fill="#536c58" />
        <rect x="-118" y="-28" width="418" height="328" fill="#b29968" />
        <rect x="0" y="-300" width="300" height="272" fill="#9a7358" />
        <g stroke="#b2b6aa" strokeWidth="7">
          <path d="M 0 -300 V 300" />
          <path d="M -300 0 H 300" />
        </g>
        <rect x="-112" y="-112" width="224" height="224" fill="#384c4b" />
        {ROAD_CENTERS.map((road) => (
          <g key={road} stroke="#a3b4aa" strokeWidth="7">
            <path d={`M ${road} -112 V 112`} />
            <path d={`M -112 ${road} H 112`} />
          </g>
        ))}
        {BLOCKS.map((block) => (
          <rect
            key={`${block.x}:${block.z}`}
            x={block.x - 10}
            y={block.z - 10}
            width="20"
            height="20"
            rx="0.6"
            fill={block.park ? "#719077" : "#425d59"}
          />
        ))}
        <path
          d={`M ${p.x} ${p.z} L ${goalX} ${goalZ}`}
          stroke="#f3cf85"
          opacity="0.7"
          strokeWidth={overview ? 1.5 : 0.5}
          strokeDasharray={overview ? "4 5" : "1.2 1.5"}
        />
        {Object.values(vehicles)
          .filter((car) => car.id !== activeId)
          .map((car) => (
            <rect
              key={car.id}
              x="-0.9"
              y="-1.9"
              width="1.8"
              height="3.8"
              rx="0.4"
              fill={car.id === nearby ? "#ffce75" : "#d7e3d8"}
              opacity="0.9"
              transform={`translate(${car.position.x},${car.position.z}) rotate(${(-car.heading * 180) / Math.PI})`}
            />
          ))}
        <circle
          cx={goalX}
          cy={goalZ}
          r={marker}
          fill="#f6ce7d"
          stroke="#493d26"
          strokeWidth={marker * 0.25}
        />
        <g
          transform={`translate(${p.x},${p.z}) rotate(${(-heading * 180) / Math.PI})`}
        >
          <circle r={marker * 1.5} fill="#122b2b" opacity="0.5" />
          <path
            d={`M 0 ${marker * 1.2} L ${-marker} ${-marker} L 0 ${-marker * 0.55} L ${marker} ${-marker} Z`}
            fill="#dbffe9"
            stroke="#1f4944"
            strokeWidth={marker * 0.16}
          />
        </g>
      </svg>
      <span className="map-north" aria-hidden="true">
        N
      </span>
    </button>
  );
}

export default function HUD({
  lowQuality,
  setLowQuality,
  showHelp,
  setShowHelp,
  lightingMode,
  setLightingMode,
}) {
  const speed = useGameStore((s) => s.speed);
  const boosting = useGameStore((s) => s.boosting);
  const paused = useGameStore((s) => s.paused);
  const ready = useGameStore((s) => s.worldReady);
  return (
    <div className="hud minimal-hud">
      <Minimap />
      <div
        className={`minimal-speed${boosting ? " is-boosting" : ""}`}
        aria-label={`Speed ${speed} kilometres per hour${boosting ? ", nitro active" : ""}`}
      >
        <strong>{String(speed).padStart(2, "0")}</strong>
        <span>km/h</span>
      </div>
      {!ready && (
        <div className="loading-overlay">
          <p className="loading-city">Loading city…</p>
        </div>
      )}
      {(paused || showHelp) && (
        <div className="pause-overlay">
          <section
            className="pause-card"
            role="dialog"
            aria-modal="true"
            aria-label={paused ? "Game paused" : "Game controls"}
          >
            <h2>{paused ? "Paused" : "Controls"}</h2>
            <dl>
              <div>
                <dt>W A S D</dt>
                <dd>Move / drive</dd>
              </div>
              <div>
                <dt>E</dt>
                <dd>Enter / exit car</dd>
              </div>
              <div>
                <dt>S / B</dt>
                <dd>Brake; hold S to reverse</dd>
              </div>
              <div>
                <dt>Space</dt>
                <dd>Jump / handbrake</dd>
              </div>
              <div>
                <dt>Shift</dt>
                <dd>Sprint / hold to boost car</dd>
              </div>
              <div>
                <dt>R</dt>
                <dd>Recover</dd>
              </div>
              <div>
                <dt>M</dt>
                <dd>Map zoom</dd>
              </div>
              <div>
                <dt>Mouse drag</dt>
                <dd>Look around</dd>
              </div>
            </dl>
            <div className="pause-settings">
              <label>
                Graphics
                <select
                  value={lowQuality ? "lite" : "balanced"}
                  onChange={(event) =>
                    setLowQuality(event.target.value === "lite")
                  }
                >
                  <option value="lite">Lite</option>
                  <option value="balanced">Balanced</option>
                </select>
              </label>
              <label>
                Lighting
                <select
                  value={lightingMode}
                  onChange={(event) => setLightingMode(event.target.value)}
                >
                  <option value="sunset">Golden hour</option>
                  <option value="cycle">Day / night cycle</option>
                  <option value="night">Night</option>
                </select>
              </label>
            </div>
            <button
              className="resume-button"
              onClick={() => {
                setShowHelp(false);
                useGameStore.getState().setPaused(false);
              }}
            >
              Resume
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
