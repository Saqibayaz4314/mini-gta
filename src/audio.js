// Lightweight Web Audio API sound manager – no library needed.
// All sounds are synthesized procedurally so there are zero external assets.

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// ---------- Engine Drone ------------------------------------------------
let engineNode = null;
let engineGain = null;

export function startEngine() {
  if (engineNode) return;
  const ac = getCtx();
  engineGain = ac.createGain();
  engineGain.gain.setValueAtTime(0, ac.currentTime);
  engineGain.connect(ac.destination);

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, ac.currentTime);
  lp.connect(engineGain);

  const oscs = [];
  for (const detune of [0, 8]) {
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(65, ac.currentTime);
    osc.detune.setValueAtTime(detune, ac.currentTime);
    osc.connect(lp);
    osc.start();
    oscs.push(osc);
  }
  engineNode = { oscs, lp };
}

/**
 * Call every frame while driving.
 * @param {number} speed  km/h
 * @param {boolean} braking
 */
export function updateEngine(speed, braking, boosting = false) {
  if (!engineNode || !engineGain) return;
  const ac = getCtx();
  const t = ac.currentTime;
  const freq = 65 + Math.min(speed, 151) * 1.42 + (boosting ? 35 : 0);
  engineNode.oscs.forEach((osc) =>
    osc.frequency.setTargetAtTime(freq, t, 0.15),
  );
  const vol = braking ? 0.06 : boosting ? 0.18 : speed > 2 ? 0.14 : 0.05;
  engineGain.gain.setTargetAtTime(vol, t, 0.08);
  engineNode.lp.frequency.setTargetAtTime(braking ? 400 : 900, t, 0.15);
}

export function stopEngine() {
  if (!engineNode || !engineGain) return;
  const ac = getCtx();
  engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.25);
  const node = engineNode;
  const gain = engineGain;
  engineNode = null;
  engineGain = null;
  setTimeout(() => {
    node.oscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    gain.disconnect();
  }, 600);
}

// ---------- Tyre Squeal --------------------------------------------------
let squealNode = null;

export function playSqueal(active) {
  if (active && !squealNode) {
    const ac = getCtx();
    const bufLen = ac.sampleRate * 0.05;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.4;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.18, ac.currentTime);
    gain.connect(ac.destination);

    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 8;
    bp.connect(gain);

    squealNode = { gain, loop: null };
    const loop = () => {
      if (!squealNode) return;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(bp);
      src.start();
      src.onended = loop;
    };
    loop();
  } else if (!active && squealNode) {
    const node = squealNode;
    squealNode = null;
    node.gain.gain.setTargetAtTime(0, getCtx().currentTime, 0.05);
  }
}

// ---------- Checkpoint Collect -------------------------------------------
export function playCheckpoint(isLapComplete = false) {
  const ac = getCtx();
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.3, ac.currentTime);
  gain.connect(ac.destination);

  const notes = isLapComplete ? [523, 659, 784, 1047, 1319] : [523, 659, 784];

  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    osc.connect(gain);
    const start = ac.currentTime + i * 0.075;
    osc.start(start);
    osc.stop(start + 0.12);
  });

  gain.gain.setTargetAtTime(0, ac.currentTime + notes.length * 0.075, 0.06);
}

// ---------- Hijack / Enter Vehicle ----------------------------------------
export function playHijack() {
  const ac = getCtx();
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.22, ac.currentTime);
  gain.connect(ac.destination);

  const osc = ac.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(90, ac.currentTime);
  osc.frequency.linearRampToValueAtTime(220, ac.currentTime + 0.18);
  osc.connect(gain);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.22);
  gain.gain.setTargetAtTime(0, ac.currentTime + 0.12, 0.04);
}

export function setAudioPaused(paused) {
  if (!ctx) return;
  if (paused && ctx.state === "running") ctx.suspend().catch(() => {});
  if (!paused && ctx.state === "suspended") ctx.resume().catch(() => {});
}
