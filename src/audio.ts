// Every sound is synthesised: a struck object rings at a few frequencies that die away at
// different rates, so each sound is a handful of decaying sines plus a click of filtered noise.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let out: GainNode | null = null;
export let soundOn = true;

let asleep = false;

export function setSound(on: boolean) { soundOn = on; }

// While paused or hidden the context is suspended, so the audio thread can idle.
export function sleep() { asleep = true; if (ctx?.state === 'running') void ctx.suspend(); }
export function wake() { asleep = false; if (ctx && ctx.state !== 'running') void ctx.resume(); }

// Browsers only allow audio after a gesture; call this from the first pointerdown or keydown.
// Safari can also leave the context 'interrupted' after a call or an app switch, so any state
// other than running gets a resume on the next gesture.
export function unlock() {
  if (ctx) { if (ctx.state !== 'running' && !asleep) void ctx.resume(); return; }
  try {
    // Game sounds should follow the iPhone's silent switch, like any other game's.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
    ctx = new AudioContext({ latencyHint: 'interactive' });
    out = ctx.createGain();
    out.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

// modes: [frequency Hz, gain, decay seconds]
function strike(modes: [number, number, number][], gain: number, pan: number, click: number, clickHz: number, delay = 0) {
  if (!soundOn || !ctx || !out || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  for (const [f, a, d] of modes) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(a * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(p);
    o.start(t); o.stop(t + d + 0.02);
  }
  if (click > 0 && noise) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise;
    bp.type = 'bandpass'; bp.frequency.value = clickHz; bp.Q.value = 1.2;
    g.gain.setValueAtTime(click * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    n.connect(bp).connect(g).connect(p);
    n.start(t); n.stop(t + 0.03);
  }
}

// Speeds are in m/s; harder hits are louder and a touch higher.
export function paddle(speed: number, pan: number, mine: boolean) {
  const k = Math.min(1, speed / 11), up = 1 + k * 0.12;
  strike([[1180 * up, 0.5, 0.05], [2650 * up, 0.25, 0.03], [420, 0.18, 0.04]], 0.35 + k * 0.5, pan, 0.9, mine ? 3200 : 2600);
}

export function bounce(speed: number, pan: number) {
  const k = Math.min(1, speed / 11);
  strike([[3900, 0.3, 0.025], [5600, 0.16, 0.015], [230, 0.4, 0.05]], 0.3 + k * 0.35, pan, 0.6, 5200);
}

export function wall(speed: number, pan: number) {
  const k = Math.min(1, speed / 11);
  strike([[640, 0.45, 0.07], [1480, 0.2, 0.04], [150, 0.4, 0.08]], 0.35 + k * 0.4, pan, 0.5, 1800);
}

export function patch(pan: number) {
  strike([[1568, 0.3, 0.4], [2349, 0.2, 0.3], [3136, 0.08, 0.2]], 0.5, pan, 0, 0);
}

// A point: up a fifth when it's yours, down a third when it isn't.
export function point(mine: boolean) {
  const notes = mine ? [784, 1175] : [659, 523];
  notes.forEach((f, i) => strike([[f, 0.22, 0.35], [f * 2, 0.05, 0.2]], 0.6, 0, 0, 0, i * 0.11));
}

export function miss() { strike([[180, 0.5, 0.18], [95, 0.4, 0.25]], 0.5, 0, 0.3, 400); }
