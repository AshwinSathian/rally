// Solo: bouncing a ball on a bat held in your hand, for as long as you can keep it up.
// Pure and deterministic like sim.ts: metres and seconds, 240 Hz, a seeded random for the
// ball's drift. The bat's face is a horizontal disc; x runs left to right, y away from you,
// z up. The bat rests at z = 0 and the floor is about a metre below.

import { TICK, clamp } from './sim.ts';

export const BAT_R = 0.09; // radius of the rubber face (a real one is about 0.075)
export const RIM = 0.012; // the wooden edge around it
export const BALL_R = 0.02;
export const FLOOR = -0.95;
export const REACH = { x: 0.3, y: 0.2 }; // how far the hand moves from where it starts
const HOLD_Z = 0.36; // the ball's height above the bat before you drop it
const APEX = 0.42; // a normal bounce rises this far above the bat
const APEX_HIGH = 0.75; // and a flicked one this far
const RESTITUTION = 0.82;
const TILT = 0.18; // sideways push per unit of upward speed at the very edge of the face
const DRAG = 0.9995; // per tick, sideways only
const FLICK_T = 0.2; // seconds for the wrist to go up and back
const FLICK_A = 0.06; // and how far up it goes
const CLEAN = 0.35; // a contact inside this fraction of the radius is a clean hit
const GRACE = 0.06; // a flick this soon after a contact still counts for that bounce

export interface Juggle {
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  bat: { x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number };
  flick: number; // seconds since the flick started, or -1
  sinceHit: number; // seconds since the last contact
  last: { gain: number; high: boolean; edge: boolean } | null; // the last contact, for a late flick
  held: boolean; // the ball hasn't been dropped yet
  live: boolean; // in play: false once it falls past the bat
  bounces: number;
  points: number;
  streak: number; // clean hits in a row
  bestStreak: number;
  cleans: number;
  highs: number;
  seed: number;
}

export type JEvent =
  | { t: 'hit'; x: number; y: number; speed: number; clean: boolean; edge: boolean; high: boolean; mult: number; gain: number }
  | { t: 'drop'; x: number; y: number }
  | { t: 'floor'; x: number; y: number; speed: number };

export function create(seed = 1): Juggle {
  const j: Juggle = {
    ball: { x: 0, y: 0, z: HOLD_Z, vx: 0, vy: 0, vz: 0 },
    bat: { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0 },
    flick: -1, sinceHit: 99, last: null, held: true, live: true, bounces: 0, points: 0, streak: 0, bestStreak: 0, cleans: 0, highs: 0, seed,
  };
  return j;
}

// mulberry32, for the drift each bounce adds.
function rand(j: Juggle) {
  let t = (j.seed = (j.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// The game speeds up as you go: gravity rises, so bounces come quicker, and each bounce adds a
// little more random drift that you have to follow and correct.
export const gravity = (bounces: number) => Math.min(11, 6.5 + 0.06 * bounces);
const drift = (bounces: number) => Math.min(0.2, 0.01 + 0.0025 * bounces);
// Points for a hit: clean hits in a row raise the multiplier by one every five, up to four.
export const multiplier = (streak: number) => Math.min(4, 1 + Math.floor(streak / 5));

export function release(j: Juggle) {
  if (!j.held) return;
  j.held = false;
  j.ball.vx = j.ball.vy = j.ball.vz = 0;
}

// A flick of the wrist: the bat rises a few centimetres and comes back. Meet the ball on the way
// up and it goes high. A flick a moment too late, just after the ball has left the bat, still
// counts for that bounce: returns the extra points it earned, or 0.
export function flick(j: Juggle): number {
  if (j.held) { release(j); return 0; }
  if (!j.live) return 0;
  if (j.sinceHit <= GRACE && j.last && !j.last.high && !j.last.edge && j.ball.vz > 0) {
    j.ball.vz = Math.sqrt(2 * gravity(j.bounces) * APEX_HIGH) - gravity(j.bounces) * j.sinceHit;
    j.last.high = true;
    j.highs++;
    j.points += j.last.gain;
    return j.last.gain;
  }
  if (j.flick < 0) j.flick = 0;
  return 0;
}

const flickZ = (t: number) => (t < 0 || t > FLICK_T ? 0 : FLICK_A * Math.sin((Math.PI * t) / FLICK_T));

// Move the bat toward where the hand wants it. Velocity is smoothed over about 30 ms, as for
// the table paddles, so one jittery pointer sample doesn't fling the ball.
export function moveBat(j: Juggle, tx: number, ty: number) {
  const b = j.bat;
  b.px = b.x; b.py = b.y; b.pz = b.z;
  b.x = clamp(tx, -REACH.x, REACH.x);
  b.y = clamp(ty, -REACH.y, REACH.y);
  if (j.flick >= 0) { j.flick += TICK; if (j.flick > FLICK_T) j.flick = -1; }
  b.z = flickZ(j.flick);
  const k = 0.13;
  b.vx += ((b.x - b.px) / TICK - b.vx) * k;
  b.vy += ((b.y - b.py) / TICK - b.vy) * k;
}

export function step(j: Juggle, out: JEvent[]) {
  const ball = j.ball, bat = j.bat;
  if (j.held) { ball.x = bat.x; ball.y = bat.y; ball.z = bat.z + HOLD_Z; return; }
  const g = gravity(j.bounces);
  j.sinceHit += TICK;
  const x0 = ball.x, y0 = ball.y, z0 = ball.z;
  ball.vz -= g * TICK;
  ball.vx *= DRAG; ball.vy *= DRAG;
  ball.x += ball.vx * TICK; ball.y += ball.vy * TICK; ball.z += ball.vz * TICK;

  if (j.live) {
    // The ball's underside against the bat's face, both moving in straight lines over the tick:
    // the gap closes linearly, so the moment it reaches zero is exact.
    const gap0 = z0 - BALL_R - bat.pz, gap1 = ball.z - BALL_R - bat.z;
    const falling = ball.vz - (bat.z - bat.pz) / TICK < 0;
    // A ball already a little below the face only counts if it was over the face, so a bat
    // can't scoop up a ball that has fallen past its side.
    const wasOver = Math.hypot(x0 - bat.px, y0 - bat.py) <= BAT_R + RIM;
    if (falling && gap1 <= 0 && (gap0 >= 0 || (gap0 >= -BALL_R && wasOver))) {
      const f = gap0 <= 0 ? 0 : gap0 / (gap0 - gap1);
      const cx = x0 + (ball.x - x0) * f, cy = y0 + (ball.y - y0) * f;
      const bx = bat.px + (bat.x - bat.px) * f, by = bat.py + (bat.y - bat.py) * f, bz = bat.pz + (bat.z - bat.pz) * f;
      const dx = cx - bx, dy = cy - by, d = Math.hypot(dx, dy);
      if (d <= BAT_R + RIM + BALL_R * 0.6) {
        hit(j, cx, cy, bz + BALL_R, dx, dy, d, g, f, out);
        return;
      }
    }
    // Past the bat's face without touching it: dropped.
    if (ball.z - BALL_R < bat.z - 0.03) {
      j.live = false;
      j.flick = -1;
      out.push({ t: 'drop', x: ball.x, y: ball.y });
    }
  }

  // The floor, for the ball on its way down after a drop.
  if (ball.z - BALL_R <= FLOOR && ball.vz < 0) {
    ball.z = FLOOR + BALL_R;
    const speed = -ball.vz;
    if (speed > 0.4) out.push({ t: 'floor', x: ball.x, y: ball.y, speed });
    ball.vz = speed > 0.4 ? speed * 0.55 : 0;
    ball.vx *= 0.8; ball.vy *= 0.8;
  }
}

function hit(j: Juggle, cx: number, cy: number, cz: number, dx: number, dy: number, d: number, g: number, f: number, out: JEvent[]) {
  const ball = j.ball, bat = j.bat;
  const batVz = j.flick >= 0 ? (FLICK_A * Math.PI / FLICK_T) * Math.cos((Math.PI * j.flick) / FLICK_T) : 0;
  const vin = batVz - ball.vz; // closing speed
  const edge = d > BAT_R;
  const high = !edge && batVz > 0.15;
  const vBase = Math.sqrt(2 * g * APEX);
  let vz: number;
  if (edge) vz = vin * 0.45; // the wooden rim: a dead, low bounce
  else if (high) vz = Math.sqrt(2 * g * APEX_HIGH);
  else vz = Math.max(vin * RESTITUTION, vBase);
  // Sideways: the ball keeps some of what it had, the moving bat drags it along, the face
  // tilts it outward the further from the centre it lands, and a little drift is added.
  const ux = d > 1e-9 ? dx / d : 0, uy = d > 1e-9 ? dy / d : 0;
  const off = Math.min(1, d / BAT_R);
  const push = edge ? 0.9 : TILT * vz * off;
  const a = rand(j) * Math.PI * 2, k = edge ? 0 : drift(j.bounces);
  ball.vx = clamp(ball.vx * 0.7 + bat.vx * 0.55 + ux * push + Math.cos(a) * k, -1.5, 1.5);
  ball.vy = clamp(ball.vy * 0.7 + bat.vy * 0.55 + uy * push + Math.sin(a) * k, -1.5, 1.5);
  ball.vz = vz;
  ball.x = cx; ball.y = cy; ball.z = cz;
  // Spend the rest of the tick on the new heading.
  const rest = (1 - f) * TICK;
  ball.x += ball.vx * rest; ball.y += ball.vy * rest; ball.z += ball.vz * rest;

  const clean = !edge && d <= BAT_R * CLEAN;
  j.streak = clean ? j.streak + 1 : 0;
  j.bestStreak = Math.max(j.bestStreak, j.streak);
  if (clean) j.cleans++;
  if (high) j.highs++;
  const mult = edge ? 1 : multiplier(j.streak);
  const gain = mult * (high ? 2 : 1);
  j.bounces++;
  j.points += gain;
  j.sinceHit = 0;
  j.last = { gain, high, edge };
  out.push({ t: 'hit', x: cx, y: cy, speed: vin, clean, edge, high, mult, gain });
}

// Where the ball will next come down to the bat's resting height, and how long until it does.
// Used by the autoplay bot.
export function landing(j: Juggle) {
  const b = j.ball, g = gravity(j.bounces);
  const h = b.z - BALL_R;
  // h + vz t - g t^2 / 2 = 0
  const t = (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * g * h))) / g;
  return { x: b.x + b.vx * t, y: b.y + b.vy * t, t };
}
