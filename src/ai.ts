// The opponent. It reads the ball the way a person does: late, roughly at first, better as the
// ball gets closer, and it can only move so fast. Its prediction uses the game's own ball
// physics, so when it misses it is because of those limits, never a dice roll that says "miss".
import { HALF_L, HALF_W, LAND_REACH, PAD_HALF, TICK, clamp, movePad, serve, zone, type Ball, type Event, type Side, type State } from './sim.ts';

export interface Level {
  name: string;
  react: number; // seconds before it starts moving for a new shot
  sigma: number; // metres of misread per second of flight left; shrinks as the ball comes in
  vmax: number; // paddle speed, m/s
  amax: number; // paddle acceleration, m/s^2
  margin: number; // how far inside the table's side it aims
  smash: number; // chance of stepping into a ball that comes back slow
}

export const LEVELS: Level[] = [
  { name: 'Casual', react: 0.28, sigma: 0.2, vmax: 2.3, amax: 9, margin: 0.42, smash: 0 },
  { name: 'Club', react: 0.2, sigma: 0.12, vmax: 3, amax: 14, margin: 0.28, smash: 0.25 },
  { name: 'Pro', react: 0.15, sigma: 0.07, vmax: 3.8, amax: 20, margin: 0.16, smash: 0.5 },
];

// Where the ball will cross y = yc, stepping exactly as sim.step does. Returns the time it takes
// too, or null if it will never get there.
export function predict(b: Ball, yc: number, curveDecay = 0.9985): { x: number; t: number } | null {
  if (b.vy === 0 || (yc - b.y) * b.vy < 0) return null;
  let x = b.x, y = b.y, vx = b.vx, c = b.curve, t = 0;
  for (let i = 0; i < 2400; i++) {
    vx += c * TICK;
    c *= curveDecay;
    const nx = x + vx * TICK, ny = y + b.vy * TICK;
    if ((ny - yc) * b.vy >= 0) {
      const f = (yc - y) / (ny - y);
      return { x: x + (nx - x) * f, t: t + TICK * f };
    }
    x = nx; y = ny; t += TICK;
  }
  return null;
}

export class Bot {
  side: Side;
  level: Level;
  private seed: number;
  private shot = -1; // which shot it last planned for (state.hits)
  private wait = 0; // reaction time left
  private z = 0; // this shot's misread, in standard deviations
  private aimX = 0; // where on the other half it wants the ball to land
  private smashing = false;
  private serveIn = 0.9;
  private vx = 0;
  private vy = 0;
  tx = 0; // where it is heading, exposed for tests and the debug view
  ty = 0;

  constructor(side: Side, level: Level, seed = 7) {
    this.side = side; this.level = level; this.seed = seed;
    this.ty = side === 1 ? HALF_L + 0.2 : -HALF_L - 0.2;
  }

  private rand() {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private gauss() { return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand()); }

  // Called once per tick, before sim.step.
  // `hold` keeps it from serving, for the pause after a point.
  tick(s: State, out?: Event[], hold = false) {
    const L = this.level, me = this.side, dir = me === 1 ? 1 : -1;
    const b = s.ball, p = s.pads[me];
    const home = dir * (HALF_L + 0.22);
    let tx = 0, ty = home;

    if (!s.live) {
      if (s.server === me) {
        tx = clamp(p.x, -HALF_W + 0.2, HALF_W - 0.2);
        if (!hold && (this.serveIn -= TICK) <= 0) { serve(s, out); this.serveIn = 0.6 + this.rand() * 0.6; }
      }
      this.shot = -1;
    } else if (b.vy * dir > 0) {
      // Coming my way.
      if (this.shot !== s.hits) {
        this.shot = s.hits;
        this.wait = L.react * (0.8 + this.rand() * 0.4);
        this.z = this.gauss();
        const speed = Math.hypot(b.vx, b.vy);
        this.smashing = speed < 4.6 && this.rand() < L.smash;
        // Aim away from the other player, as wide as this level dares.
        const them = s.pads[(1 - me) as Side].x;
        const edge = HALF_W - L.margin;
        this.aimX = (them > 0 ? -1 : 1) * edge * (0.45 + this.rand() * 0.55);
      }
      if (this.wait > 0) {
        this.wait -= TICK;
        tx = p.x; ty = p.y; // still reading the shot
      } else {
        const yc = dir * (HALF_L + (this.smashing ? 0.4 : 0.14));
        const hit = predict(b, yc);
        if (hit) {
          const guess = hit.x + this.z * L.sigma * hit.t * (1 + Math.abs(b.curve) * 0.4);
          // Contact offset u lands the ball at u * LAND_REACH across the table.
          const u = clamp(this.aimX / LAND_REACH, -0.85, 0.85);
          tx = guess - u * PAD_HALF;
          ty = yc;
          // Step in late for a smash.
          if (this.smashing && hit.t < 0.16) ty = yc - dir * 0.45;
        } else { tx = p.x; ty = p.y; }
      }
    } else {
      // Going away: drift back toward the middle of where the reply could come.
      tx = b.x * 0.35; ty = home;
    }
    this.tx = tx; this.ty = ty;
    this.drive(s, tx, ty);
  }

  // Accelerate toward the target, braking in time to stop on it: a speed limit and an
  // acceleration limit, which is what makes a far ball unreachable.
  private drive(s: State, tx: number, ty: number) {
    const L = this.level, p = s.pads[this.side], z = zone(this.side, s.mode);
    tx = clamp(tx, z.x0, z.x1); ty = clamp(ty, z.y0, z.y1);
    const want = (d: number, v: number, vmax: number) => {
      const stop = Math.sqrt(2 * L.amax * Math.abs(d)) * Math.sign(d);
      const goal = clamp(stop, -vmax, vmax);
      return v + clamp(goal - v, -L.amax * TICK, L.amax * TICK);
    };
    const vmaxY = this.smashing ? L.vmax * 1.3 : L.vmax;
    this.vx = want(tx - p.x, this.vx, L.vmax);
    this.vy = want(ty - p.y, this.vy, vmaxY);
    movePad(s, this.side, p.x + this.vx * TICK, p.y + this.vy * TICK);
  }
}
