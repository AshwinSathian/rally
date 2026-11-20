// Rally's table: physics and rules for a match. Pure and deterministic: no DOM, no clock, no
// Math.random. (Solo is a different game with its own physics, in juggle.ts.)
// Units are metres and seconds. The table is centred on the origin; x runs across it,
// y runs along it, and the player's end is y < 0.

export const TICK = 1 / 240;
export const TABLE_W = 1.525;
export const TABLE_L = 2.74;
export const HALF_W = TABLE_W / 2;
export const HALF_L = TABLE_L / 2;
export const BALL_R = 0.028;
export const PAD_HALF = 0.13; // half the width of the paddle's hitting edge
export const PAD_R = 0.02; // thickness of that edge, as a capsule radius
const REACH = HALF_W + 0.22; // how far out to either side a player can stand
const HIT_R = BALL_R + PAD_R;
export const CONTACT = PAD_HALF + HIT_R; // from the paddle's centre to the furthest contact
export const LAND_REACH = HALF_W * 1.136; // match: where a hit off the paddle's very tip lands
const START_SPEED = 3.3;
const SPEED_STEP = 0.11;
const MAX_SPEED = 11;
const MAX_CURVE = 1.6; // m/s^2 of sideways pull from spin
export const SPIN_DECAY = 0.9985; // per tick, so spin halves in about 1.9 s

export type Side = 0 | 1; // 0 is the player (near end), 1 the far end

export interface Vec { x: number; y: number }

export interface Paddle {
  x: number; y: number; // where the paddle is now
  px: number; py: number; // where it was at the start of this tick
  vx: number; vy: number; // smoothed velocity, used for spin and smashes
}

export interface Ball {
  x: number; y: number; vx: number; vy: number;
  curve: number; // sideways acceleration from spin
  // Height above the table, drawn only and never used to decide a point: a parabola from z0
  // that peaks `arcH` above the straight line and ends on the table after `arcT` seconds.
  z: number; z0: number; arcAge: number; arcT: number; arcH: number;
  bounceY: number; // in a match, where along y this shot lands
  bounced: boolean; // has it landed on the receiver's half yet
}

export type Event =
  | { t: 'hit'; side: Side; speed: number; u: number; x: number }
  | { t: 'bounce'; x: number; y: number; speed: number }
  | { t: 'point'; winner: Side; why: 'wide' | 'missed' };

export interface State {
  ball: Ball;
  pads: [Paddle, Paddle];
  live: boolean; // ball in play
  lastHit: Side;
  hits: number; // in this rally
  score: [number, number];
  server: Side;
}

// Where each paddle may go. The near edge of the zone overlaps the table by a little, which
// still sits behind the deepest landing spot, so a ball always lands before it can be hit.
export function zone(side: Side) { return ZONES[side]; }
const ZONES = [makeZone(0), makeZone(1)];
function makeZone(side: Side) {
  const y0 = HALF_L - 0.12, y1 = HALF_L + 0.55;
  return side === 0
    ? { x0: -REACH, x1: REACH, y0: -y1, y1: -y0 }
    : { x0: -REACH, x1: REACH, y0, y1 };
}

function pad(y: number): Paddle { return { x: 0, y, px: 0, py: y, vx: 0, vy: 0 }; }

export function create(): State {
  const s: State = {
    live: false, lastHit: 0, hits: 0, score: [0, 0], server: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0, curve: 0, z: 0, z0: 0, arcAge: 0, arcT: 0, arcH: 0, bounceY: 0, bounced: false },
    pads: [pad(-HALF_L - 0.2), pad(HALF_L + 0.2)],
  };
  holdBall(s);
  return s;
}

// --- rules -----------------------------------------------------------------------------------

// Eleven points, win by two. Service changes every two points, and every point from 10-10.
export function serverFor(score: [number, number], first: Side): Side {
  const n = score[0] + score[1];
  const turns = n < 20 ? Math.floor(n / 2) : 10 + (n - 20);
  return ((first + turns) % 2) as Side;
}

export function winner(score: [number, number]): Side | -1 {
  const [a, b] = score;
  if (a >= 11 && a - b >= 2) return 0;
  if (b >= 11 && b - a >= 2) return 1;
  return -1;
}

export function holdBall(s: State) {
  const b = s.ball;
  s.live = false;
  s.hits = 0;
  b.vx = b.vy = b.curve = 0;
  b.arcT = 0;
  b.bounced = false;
  const p = s.pads[s.server];
  b.x = p.x;
  b.y = p.y + (p.y < 0 ? 1 : -1) * (HIT_R + 0.01);
  b.z = 0.16;
}

// The server's paddle carries the ball until serve() is called.
// The serve goes where you stand, pushed further by a sideways flick: from the left of the
// table it lands on the left of theirs. `u` overrides that (the bot picks its own).
export function serve(s: State, out?: Event[], u?: number) {
  if (s.live) return;
  const side = s.server;
  const p = s.pads[side];
  // A serve from outside the table's width would be out before it started.
  const edge = HALF_W - 0.12;
  p.x = Math.max(-edge, Math.min(edge, p.x));
  s.ball.x = p.x;
  const aim = u ?? clamp(p.x / HALF_W * 0.7 + p.vx * 0.25, -0.7, 0.7);
  strike(s, side, aim);
  s.live = true;
  out?.push({ t: 'hit', side, speed: Math.hypot(s.ball.vx, s.ball.vy), u: aim, x: s.ball.x });
}

// Where across the table a hit at contact offset u lands. Gentle in the middle and steep at
// the tip, so a centred hit is safe and only the outer 7% of the paddle sends it off the side.
export const landX = (u: number) => (0.65 * u + 0.35 * u * u * u) * LAND_REACH;

// The contact offset that lands the ball at x (Newton's method on landX).
export function aimFor(x: number) {
  let u = clamp(x / LAND_REACH, -1, 1);
  for (let i = 0; i < 6; i++) u -= (landX(u) - x) / ((0.65 + 1.05 * u * u) * LAND_REACH);
  return clamp(u, -1, 1);
}

// The shot model. Where the ball meets the paddle sets its direction; the paddle's sideways
// speed adds spin (a curving flight) and its forward speed adds pace.
function strike(s: State, side: Side, u: number) {
  const b = s.ball, p = s.pads[side];
  const dir = side === 0 ? 1 : -1;
  // A serve can be pushed only a little: otherwise a flick of the mouse gives an unreturnable one.
  const fwd = Math.min(s.hits === 0 ? 1.5 : Infinity, Math.max(0, p.vy * dir));
  const base = Math.min(MAX_SPEED, START_SPEED + SPEED_STEP * s.hits);
  const speed = Math.min(MAX_SPEED, Math.max(base, Math.hypot(b.vx, b.vy) * 0.92) + fwd * 0.55);
  // The contact point picks where across the table the ball lands, wherever you stand
  // (landX). Moving the paddle sideways nudges the landing spot a little further.
  const depth = clamp(0.45 + (speed - START_SPEED) * 0.11, 0.45, HALF_L - 0.2);
  b.bounceY = dir * depth;
  const lx = landX(u) + clamp(p.vx * 0.05, -0.05, 0.05);
  const ex = lx - b.x, ey = b.bounceY - b.y, len = Math.hypot(ex, ey);
  b.vx = speed * ex / len;
  b.vy = speed * ey / len;
  b.curve = clamp(p.vx * 0.9, -MAX_CURVE, MAX_CURVE);
  b.bounced = false;
  // Height is for the eye only: an arc that peaks over the net and comes down on bounceY.
  arc(b, Math.abs((b.bounceY - b.y) / b.vy), 0.2 + 0.25 * START_SPEED / Math.hypot(b.vx, b.vy));
  s.lastHit = side;
  s.hits++;
}

// --- collision -------------------------------------------------------------------------------

// Earliest time in [0, 1] at which a point moving by (dx, dy) from (x, y) comes within radius r
// of the segment from (-h, 0) to (h, 0); -1 if it never does. The paddle's own motion has
// already been subtracted, so this is exact for a paddle and ball that both move in straight
// lines over the step, however fast either of them goes.
export function sweep(x: number, y: number, dx: number, dy: number, h: number, r: number): number {
  if (Math.abs(y) <= r && Math.abs(x) <= h) return 0;
  if (dist2Seg(x, y, h) <= r * r) return 0;
  let best = -1;
  // The flat sides: y = +r or -r, with |x| <= h at that moment.
  if (dy !== 0) {
    best = side(x, y, dx, dy, h, r, best);
    best = side(x, y, dx, dy, h, -r, best);
  }
  // The round ends: circles of radius r at (+h, 0) and (-h, 0).
  best = cap(x - h, y, dx, dy, r, best);
  best = cap(x + h, y, dx, dy, r, best);
  return best;
}

function side(x: number, y: number, dx: number, dy: number, h: number, edge: number, best: number) {
  const t = (edge - y) / dy;
  return t >= 0 && t <= 1 && Math.abs(x + dx * t) <= h && (best < 0 || t < best) ? t : best;
}

function cap(ox: number, y: number, dx: number, dy: number, r: number, best: number) {
  const a = dx * dx + dy * dy;
  if (a === 0) return best;
  const bq = ox * dx + y * dy, c = ox * ox + y * y - r * r;
  const disc = bq * bq - a * c;
  if (disc < 0) return best;
  const t = (-bq - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 && (best < 0 || t < best) ? t : best;
}

function dist2Seg(x: number, y: number, h: number) {
  const cx = clamp(x, -h, h);
  return (x - cx) ** 2 + y * y;
}

// --- stepping --------------------------------------------------------------------------------

// Move a paddle toward where its controller wants it, inside its zone. Velocity is smoothed over
// about 30 ms so one jittery pointer sample can't turn into a smash.
export function movePad(s: State, side: Side, tx: number, ty: number) {
  const p = s.pads[side], z = zone(side);
  p.px = p.x; p.py = p.y;
  p.x = clamp(tx, z.x0, z.x1);
  p.y = clamp(ty, z.y0, z.y1);
  const k = 0.13;
  p.vx += ((p.x - p.px) / TICK - p.vx) * k;
  p.vy += ((p.y - p.py) / TICK - p.vy) * k;
}

// Advance the ball one tick. Paddles must already be at their new spots (movePad).
export function step(s: State, out: Event[]) {
  const b = s.ball;
  if (!s.live) {
    const p = s.pads[s.server];
    b.x = p.x;
    b.y = p.y + (p.y < 0 ? 1 : -1) * (HIT_R + 0.01);
    return;
  }
  const x0 = b.x, y0 = b.y;
  b.vx += b.curve * TICK;
  b.curve *= SPIN_DECAY;
  const dx = b.vx * TICK, dy = b.vy * TICK;

  // Landing comes first: a ball that comes down inside this tick does so before any paddle
  // can reach it, and a wide one is called even if it would have touched a paddle after.
  if (!b.bounced) {
    const f = (b.bounceY - y0) / dy;
    if (f >= 0 && f <= 1) {
      const lx = x0 + dx * f;
      b.bounced = true;
      if (Math.abs(lx) > HALF_W) { b.x = lx; b.y = b.bounceY; end(s, (1 - s.lastHit) as Side, 'wide', out); return; }
      out.push({ t: 'bounce', x: lx, y: b.bounceY, speed: Math.hypot(b.vx, b.vy) });
      // Second arc, up off the table and down again past the far end.
      arc(b, Math.abs((HALF_L + 0.9) / b.vy) * 1.1, 0.16 * START_SPEED / Math.abs(b.vy) + 0.03);
    }
  }

  // Paddles. Only the one the ball is heading for can hit it, so a ball that has just been
  // struck can't be struck again on its way out.
  const side: Side = b.vy < 0 ? 0 : 1;
  {
    const p = s.pads[side];
    const rx = x0 - p.px, ry = y0 - p.py;
    const t = sweep(rx, ry, dx - (p.x - p.px), dy - (p.y - p.py), PAD_HALF, HIT_R);
    if (t >= 0) {
      b.x = x0 + dx * t;
      b.y = y0 + dy * t;
      const padX = p.px + (p.x - p.px) * t;
      // -1 at one rounded tip, +1 at the other, over the whole width that can touch the ball.
      const u = clamp((b.x - padX) / CONTACT, -1, 1);
      strike(s, side, u);
      out.push({ t: 'hit', side, speed: Math.hypot(b.vx, b.vy), u, x: b.x });
      // Spend the rest of the tick on the new heading, so the ball leaves the paddle cleanly.
      const rest = 1 - t;
      b.x += b.vx * TICK * rest;
      b.y += b.vy * TICK * rest;
      return;
    }
  }

  b.x += dx; b.y += dy;
  // Past the receiver: the point goes to whoever hit it.
  if (Math.abs(b.y) > HALF_L + 0.9 || Math.abs(b.x) > 2.4) { end(s, s.lastHit, 'missed', out); return; }
  b.arcAge += TICK;
  const f = b.arcT > 0 ? Math.min(b.arcAge / b.arcT, 1.6) : 0;
  b.z = Math.max(-0.76, b.z0 * (1 - f) + 4 * b.arcH * f * (1 - f));
}

function arc(b: Ball, t: number, h: number) {
  b.z0 = b.z; b.arcAge = 0; b.arcT = t; b.arcH = h;
}

function end(s: State, w: Side, why: 'wide' | 'missed', out: Event[]) {
  s.live = false;
  s.score[w]++;
  out.push({ t: 'point', winner: w, why });
}

// Set up the next serve after a point. `first` is whoever served first in the game.
export function nextPoint(s: State, first: Side) {
  s.server = serverFor(s.score, first);
  holdBall(s);
}

export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
