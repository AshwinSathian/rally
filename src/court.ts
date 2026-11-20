// Solo's view: the court seen straight from above, no table and no perspective. Three walls
// and the floor along the bottom; the paddle moves along the floor's edge.
import { BALL_R, CONTACT, HALF_L, PAD_R, SOLO_FLOOR, TARGET_HALF } from './sim.ts';
import type { Frame, Fx, Layer } from './view.ts';

export interface Court {
  s: number; // pixels per metre
  ox: number; oy: number; // screen position of world (0, 0)
  w: number; h: number; dpr: number;
  halfW: number; // half the court's width, in metres
}

const WALL = 0.06; // drawn wall thickness, outside the playing area
const C = {
  bg0: '#0B1220', bg1: '#111C33', floor: '#132342', grid: 'rgba(244,247,251,0.035)',
  wall: '#2A66B3', wallHi: '#7FB2F0', ground: '#E5484D',
  ball: '#FF8A2A', ballHi: '#FFD2A6', pad: '#E5484D', padHi: '#FF9A9D', patch: '#FFB224',
};

const LENGTH = HALF_L - SOLO_FLOOR + WALL; // floor to the outside of the top wall

// How wide a court suits this screen: as wide as the space allows, between the table's
// width and the widest court the game allows (sim clamps it).
export function courtWidthFor(w: number, h: number, top: number) {
  return ((w - 32) / (h - top - 16)) * LENGTH / 2 - WALL;
}

// Fit the court (walls included) into the screen below the HUD, centred.
export function courtFit(w: number, h: number, dpr: number, top: number, halfW: number): Court {
  const cw = 2 * (halfW + WALL), ch = LENGTH;
  const pad = Math.max(12, Math.min(w, h) * 0.04);
  const s = Math.min((w - pad * 2) / cw, (h - top - pad) / ch);
  const ox = w / 2;
  const oy = top + (h - top - pad - ch * s) / 2 + (HALF_L + WALL) * s;
  return { s, ox, oy, w, h, dpr, halfW };
}

const X = (c: Court, x: number) => c.ox + x * c.s;
const HW = (c: Court) => c.halfW;
const Y = (c: Court, y: number) => c.oy - y * c.s;

export function courtToWorld(c: Court, sx: number, sy: number) {
  return { x: (sx - c.ox) / c.s, y: (c.oy - sy) / c.s };
}

// Background, floor, walls and the ground line: everything that never moves.
export function paintCourt(c: Court, old?: Layer): Layer {
  const cv = old?.cv ?? document.createElement('canvas');
  cv.width = Math.round(c.w * c.dpr); cv.height = Math.round(c.h * c.dpr);
  const g = cv.getContext('2d')!;
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const bg = g.createLinearGradient(0, 0, 0, c.h);
  bg.addColorStop(0, C.bg0); bg.addColorStop(1, C.bg1);
  g.fillStyle = bg; g.fillRect(0, 0, c.w, c.h);
  const x0 = X(c, -HW(c)), x1 = X(c, HW(c)), yt = Y(c, HALF_L), yf = Y(c, SOLO_FLOOR);
  // The floor of the court, lit from the top wall down.
  const fl = g.createLinearGradient(0, yt, 0, yf);
  fl.addColorStop(0, '#17305A'); fl.addColorStop(1, C.floor);
  g.fillStyle = fl; g.fillRect(x0, yt, x1 - x0, yf - yt);
  // A faint half-metre grid gives a sense of speed without competing with the ball.
  g.strokeStyle = C.grid; g.lineWidth = 1;
  g.beginPath();
  for (let x = -Math.floor(HW(c) / 0.5); x <= Math.floor(HW(c) / 0.5); x++) { const px = Math.round(X(c, x * 0.5)) + 0.5; g.moveTo(px, yt); g.lineTo(px, yf); }
  for (let y = HALF_L - 0.5; y > SOLO_FLOOR; y -= 0.5) { const py = Math.round(Y(c, y)) + 0.5; g.moveTo(x0, py); g.lineTo(x1, py); }
  g.stroke();
  // Walls: left, top, right, as one rounded bracket.
  const t = WALL * c.s;
  g.fillStyle = C.wall;
  g.beginPath();
  g.roundRect(x0 - t, yt - t, x1 - x0 + 2 * t, t, [t, t, 0, 0]);
  g.rect(x0 - t, yt, t, yf - yt);
  g.rect(x1, yt, t, yf - yt);
  g.fill();
  g.fillStyle = C.wallHi;
  g.fillRect(x0 - 1, yt - 1, x1 - x0 + 2, 2);
  g.fillRect(x0 - 1, yt, 2, yf - yt);
  g.fillRect(x1 - 1, yt, 2, yf - yt);
  // The ground: where the ball must not go. A red edge with a glow fading up into the court.
  const gl = g.createLinearGradient(0, yf - 0.35 * c.s, 0, yf);
  gl.addColorStop(0, 'rgba(229,72,77,0)'); gl.addColorStop(1, 'rgba(229,72,77,0.22)');
  g.fillStyle = gl; g.fillRect(x0, yf - 0.35 * c.s, x1 - x0, 0.35 * c.s);
  g.fillStyle = C.ground;
  g.fillRect(x0 - t, yf, x1 - x0 + 2 * t, Math.max(2, 0.012 * c.s));
  return { cv, x: 0, y: 0 };
}

export function drawCourt(g: CanvasRenderingContext2D, c: Court, base: Layer, f: Frame, fx: Fx[], t: number) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(base.cv, 0, 0);
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const yt = Y(c, HALF_L), th = WALL * c.s;

  // The lit stretch of the top wall, breathing a little so it reads as something to aim at.
  const pulse = 0.8 + 0.2 * Math.sin(t * 4);
  g.save();
  g.shadowColor = 'rgba(255,178,36,0.9)';
  g.shadowBlur = 16 * pulse;
  g.fillStyle = C.patch;
  g.globalAlpha = pulse;
  g.beginPath();
  g.roundRect(X(c, f.target - TARGET_HALF), yt - th, TARGET_HALF * 2 * c.s, th, th / 3);
  g.fill();
  g.restore();

  // Wall hits light the wall where the ball struck.
  for (const e of fx) {
    if (e.kind !== 'wall') continue;
    const k = 1 - e.age / e.life;
    const top = !!e.top;
    const px = top ? X(c, e.x) : X(c, Math.sign(e.x) * (HW(c) + WALL / 2));
    const py = top ? yt - th / 2 : Y(c, e.y);
    const r = (0.12 + 0.2 * (1 - k)) * c.s;
    const rg = g.createRadialGradient(px, py, 0, px, py, r);
    const col = e.gold ? '255,210,120' : '170,205,255';
    rg.addColorStop(0, `rgba(${col},${0.85 * k})`); rg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = rg;
    g.fillRect(px - r, py - r, r * 2, r * 2);
  }

  // The paddle: a rounded bar exactly as wide as the span that can touch the ball.
  let flash = 0;
  for (const e of fx) if (e.kind === 'flash') flash = Math.max(flash, 1 - e.age / e.life);
  const p = f.pads[0];
  const half = (CONTACT - BALL_R) * c.s, thick = Math.max(6, PAD_R * 2.6 * c.s);
  g.fillStyle = flash ? `rgba(255,255,255,${0.5 + 0.5 * flash})` : C.pad;
  g.shadowColor = 'rgba(229,72,77,0.55)';
  g.shadowBlur = 10 + 14 * flash;
  g.beginPath();
  g.roundRect(X(c, p.x) - half, Y(c, p.y) - thick / 2, half * 2, thick, thick / 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = C.padHi;
  g.fillRect(X(c, p.x) - half + thick / 2, Y(c, p.y) - thick / 2 + 1, half * 2 - thick, 1.5);

  // Trail, then the ball.
  const b = f.ball, r = Math.max(3, BALL_R * c.s);
  if (f.live && f.trail.length > 1) {
    g.lineCap = 'round';
    for (let i = 1; i < f.trail.length; i++) {
      const a = f.trail[i - 1], q = f.trail[i], k = i / f.trail.length;
      g.strokeStyle = `rgba(255,170,90,${k * 0.4})`;
      g.lineWidth = r * 2 * k;
      g.beginPath(); g.moveTo(X(c, a.x), Y(c, a.y)); g.lineTo(X(c, q.x), Y(c, q.y)); g.stroke();
    }
  }
  const bx = X(c, b.x), by = Y(c, b.y);
  const grad = g.createRadialGradient(bx - r * 0.35, by - r * 0.4, r * 0.1, bx, by, r);
  grad.addColorStop(0, C.ballHi); grad.addColorStop(0.5, C.ball); grad.addColorStop(1, '#C85A10');
  g.fillStyle = grad;
  g.shadowColor = 'rgba(255,138,42,0.6)';
  g.shadowBlur = 12;
  g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
}
