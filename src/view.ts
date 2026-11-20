// Drawing. A pinhole camera stands behind the player's end; the table, floor and net never
// move, so they are painted once per resize into offscreen layers, and each frame only draws
// what moves, sorted far to near with the net slotted in at y = 0.
import { BALL_R, HALF_L, HALF_W, PAD_HALF, PAD_R, zone, type Mode } from './sim.ts';

interface V3 { x: number; y: number; z: number }
export interface Cam {
  eye: V3; r: V3; u: V3; f: V3;
  F: number; cx: number; cy: number;
  w: number; h: number; dpr: number;
}

const PAD_Z = 0.13; // paddle face centre height; the input plane
const NET_H = 0.1525;
const TABLE_T = 0.03; // table top thickness, for the edge you see on the near side

export const C = {
  bg0: '#0B1220', bg1: '#14213A', floor: '#101a2e',
  table: '#1D4F91', tableHi: '#2A66B3', edge: '#0F2C55', line: '#F4F7FB',
  net: 'rgba(12,18,30,0.55)', tape: '#F4F7FB',
  ball: '#FF8A2A', ballHi: '#FFD2A6',
  you: '#E5484D', youRim: '#FF9A9D', them: '#4A5160', themRim: '#D9B27C',
};

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };

// The camera rises and tips down on tall screens, where there's room to see more of the far
// half, and sits lower on wide ones, where the table needs to fill the width.
export function camera(w: number, h: number, dpr: number, mode: Mode, top: number, left = 0): Cam {
  const t = Math.max(0, Math.min(1, (w / h - 0.55) / (1.7 - 0.55)));
  const eye = { x: 0, y: -HALF_L - 0.9 - t * 1.0, z: 5.2 - t * 3.7 };
  const look = { x: 0, y: mode === 'solo' ? 0.1 : 0.15 + t * 0.2, z: 0 };
  const f = norm(sub(look, eye));
  const r = norm(cross(f, { x: 0, y: 0, z: 1 }));
  const u = cross(r, f);
  const cam: Cam = { eye, r, u, f, F: 1, cx: 0, cy: 0, w, h, dpr };
  // Fit the parts that matter (both paddle zones and the table) inside the screen, below the HUD.
  const pts: V3[] = [];
  const z0 = zone(0, mode), z1 = zone(1, mode);
  for (const z of mode === 'solo' ? [z0] : [z0, z1]) for (const x of [z.x0 - 0.1, z.x1 + 0.1]) for (const y of [z.y0, Math.sign(z.y1) * Math.min(Math.abs(z.y1), HALF_L + 0.42)]) for (const zz of [PAD_Z + 0.09, PAD_Z - 0.18]) pts.push({ x, y, z: zz });
  for (const x of [-HALF_W, HALF_W]) for (const y of [-HALF_L, HALF_L]) pts.push({ x, y, z: 0 });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const d = sub(p, eye), cz = dot(d, f);
    const sx = dot(d, r) / cz, sy = -dot(d, u) / cz;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const pad = Math.min(w, h) * 0.04, bottom = pad + 8;
  const aw = w - left - pad * 2, ah = h - top - bottom;
  cam.F = Math.min(aw / (x1 - x0), ah / (y1 - y0));
  cam.cx = left + (w - left) / 2 - cam.F * (x0 + x1) / 2;
  cam.cy = top + ah / 2 - cam.F * (y0 + y1) / 2;
  return cam;
}

export function project(c: Cam, x: number, y: number, z: number) {
  const dx = x - c.eye.x, dy = y - c.eye.y, dz = z - c.eye.z;
  const cz = dx * c.f.x + dy * c.f.y + dz * c.f.z;
  return {
    x: c.cx + c.F * (dx * c.r.x + dy * c.r.y + dz * c.r.z) / cz,
    y: c.cy - c.F * (dx * c.u.x + dy * c.u.y + dz * c.u.z) / cz,
    s: c.F / cz, // pixels per metre at that depth
  };
}

// Screen point to the paddle plane: the inverse of project() for z = PAD_Z.
export function unproject(c: Cam, sx: number, sy: number) {
  const a = (sx - c.cx) / c.F, b = -(sy - c.cy) / c.F;
  const d = { x: c.f.x + c.r.x * a + c.u.x * b, y: c.f.y + c.r.y * a + c.u.y * b, z: c.f.z + c.r.z * a + c.u.z * b };
  const t = (PAD_Z - c.eye.z) / d.z;
  return { x: c.eye.x + d.x * t, y: c.eye.y + d.y * t };
}

function poly(g: CanvasRenderingContext2D, c: Cam, pts: [number, number, number][]) {
  g.beginPath();
  pts.forEach(([x, y, z], i) => { const p = project(c, x, y, z); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
  g.closePath();
}

// A baked image and where its top-left corner goes on the screen, in device pixels.
export interface Layer { cv: HTMLCanvasElement; x: number; y: number }

// A canvas covering the CSS-pixel box (x, y, w, h), drawn in screen coordinates. An old layer
// is resized and reused, so a resize doesn't leave full-screen canvases for the collector.
function layer(c: Cam, old: Layer | null | undefined, x = 0, y = 0, w = c.w, h = c.h) {
  const cv = old?.cv ?? document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * c.dpr)); cv.height = Math.max(1, Math.ceil(h * c.dpr));
  const g = cv.getContext('2d')!;
  // Snap the corner to a whole device pixel and translate by exactly that, so the layer lands
  // where it would have in a full-screen canvas.
  const lx = Math.floor(x * c.dpr), ly = Math.floor(y * c.dpr);
  g.setTransform(c.dpr, 0, 0, c.dpr, -lx, -ly);
  return { L: { cv, x: lx, y: ly }, g };
}

// Floor, table and lines. Everything here sits on or below the table top.
export function paintBase(c: Cam, mode: Mode, old?: Layer) {
  const { L, g } = layer(c, old);
  const bg = g.createLinearGradient(0, 0, 0, c.h);
  bg.addColorStop(0, C.bg0); bg.addColorStop(1, C.bg1);
  g.fillStyle = bg; g.fillRect(0, 0, c.w, c.h);
  // A pool of light on the floor under the table.
  const mid = project(c, 0, 0, -0.76);
  const glow = g.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, mid.s * 3.2);
  glow.addColorStop(0, 'rgba(120,160,230,0.16)'); glow.addColorStop(1, 'rgba(120,160,230,0)');
  g.fillStyle = glow; g.fillRect(0, 0, c.w, c.h);
  // Soft shadow of the table on the floor.
  g.save();
  g.filter = `blur(${Math.max(4, mid.s * 0.12)}px)`;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  poly(g, c, [[-HALF_W - 0.05, -HALF_L, -0.76], [HALF_W + 0.05, -HALF_L, -0.76], [HALF_W + 0.05, HALF_L, -0.76], [-HALF_W - 0.05, HALF_L, -0.76]]);
  g.fill();
  g.restore();
  // Near edge of the top, so the table has thickness.
  g.fillStyle = C.edge;
  poly(g, c, [[-HALF_W, -HALF_L, 0], [HALF_W, -HALF_L, 0], [HALF_W, -HALF_L, -TABLE_T], [-HALF_W, -HALF_L, -TABLE_T]]);
  g.fill();
  for (const sx of [-1, 1]) {
    poly(g, c, [[sx * HALF_W, -HALF_L, 0], [sx * HALF_W, HALF_L, 0], [sx * HALF_W, HALF_L, -TABLE_T], [sx * HALF_W, -HALF_L, -TABLE_T]]);
    g.fill();
  }
  // The top, lit from the far end.
  const a = project(c, 0, HALF_L, 0), b = project(c, 0, -HALF_L, 0);
  const tg = g.createLinearGradient(a.x, a.y, b.x, b.y);
  tg.addColorStop(0, C.tableHi); tg.addColorStop(1, C.table);
  g.fillStyle = tg;
  poly(g, c, [[-HALF_W, -HALF_L, 0], [HALF_W, -HALF_L, 0], [HALF_W, HALF_L, 0], [-HALF_W, HALF_L, 0]]);
  g.fill();
  // White lines: 2 cm edges, and the centre line in a match.
  g.fillStyle = C.line;
  const lw = 0.02;
  const strip = (x0: number, y0: number, x1: number, y1: number) => { poly(g, c, [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]); g.fill(); };
  strip(-HALF_W, -HALF_L, -HALF_W + lw, HALF_L);
  strip(HALF_W - lw, -HALF_L, HALF_W, HALF_L);
  strip(-HALF_W, -HALF_L, HALF_W, -HALF_L + lw);
  if (mode === 'match') { strip(-HALF_W, HALF_L - lw, HALF_W, HALF_L); strip(-0.0015, -HALF_L, 0.0015, HALF_L); }
  return L;
}

// The net, baked into a canvas only as big as the net itself. (Solo has its own view, court.ts.)
export function paintNet(c: Cam, mode: Mode, old?: Layer | null): Layer | null {
  if (mode === 'solo') return null;
  const o = 0.1525; // posts stand 15.25 cm out from the sides
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sx of [-1, 1]) for (const z of [-0.02, NET_H + 0.01]) {
    const p = project(c, sx * (HALF_W + o + 0.012), 0, z);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const { L, g } = layer(c, old, x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
  g.fillStyle = C.net;
  poly(g, c, [[-HALF_W - o, 0, 0], [HALF_W + o, 0, 0], [HALF_W + o, 0, NET_H], [-HALF_W - o, 0, NET_H]]);
  g.fill();
  // Mesh: a few vertical threads read as net without moiré at phone sizes.
  g.strokeStyle = 'rgba(244,247,251,0.08)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = -HALF_W - o; x <= HALF_W + o; x += 0.06) {
    const p = project(c, x, 0, 0), q = project(c, x, 0, NET_H);
    g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
  }
  g.stroke();
  g.fillStyle = C.tape;
  poly(g, c, [[-HALF_W - o, 0, NET_H], [HALF_W + o, 0, NET_H], [HALF_W + o, 0, NET_H - 0.015], [-HALF_W - o, 0, NET_H - 0.015]]);
  g.fill();
  g.fillStyle = '#C8CDD6';
  for (const sx of [-1, 1]) {
    poly(g, c, [[sx * (HALF_W + o) - 0.012, 0, -0.02], [sx * (HALF_W + o) + 0.012, 0, -0.02], [sx * (HALF_W + o) + 0.012, 0, NET_H + 0.01], [sx * (HALF_W + o) - 0.012, 0, NET_H + 0.01]]);
    g.fill();
  }
  return L;
}

export interface Fx { kind: 'ring' | 'flash' | 'wall'; x: number; y: number; age: number; life: number; side?: number; gold?: boolean }

export interface Frame {
  ball: { x: number; y: number; z: number };
  pads: [{ x: number; y: number }, { x: number; y: number }];
  trail: { x: number; y: number; z: number }[];
  live: boolean;
  target: number;
}

export function drawFrame(g: CanvasRenderingContext2D, c: Cam, mode: Mode, base: Layer, net: Layer | null, f: Frame, fx: Fx[], t: number) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(base.cv, base.x, base.y);
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const items: { y: number; draw: () => void }[] = [];
  const b = f.ball;
  items.push({ y: b.y, draw: () => drawBall(g, c, f, mode) });
  items.push({ y: f.pads[0].y + 0.001, draw: () => drawPad(g, c, f.pads[0].x, f.pads[0].y, 0, fx) });
  if (mode === 'match') {
    items.push({ y: f.pads[1].y, draw: () => drawPad(g, c, f.pads[1].x, f.pads[1].y, 1, fx) });
    if (net) items.push({ y: 0, draw: () => { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(net.cv, net.x, net.y); g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0); } });
  }
  for (const e of fx) if (e.kind === 'ring') items.push({ y: e.y + 0.002, draw: () => drawRing(g, c, e) });
  items.sort((p, q) => q.y - p.y);
  for (const it of items) it.draw();
}

function drawRing(g: CanvasRenderingContext2D, c: Cam, e: Fx) {
  const k = e.age / e.life;
  const p = project(c, e.x, e.y, 0.001);
  const r = 0.03 + k * 0.11;
  g.strokeStyle = `rgba(255,255,255,${0.55 * (1 - k)})`;
  g.lineWidth = Math.max(1, p.s * 0.008);
  g.beginPath();
  // The ring lies on the table, so it squashes by the view angle.
  const q = project(c, e.x, e.y + r, 0.001);
  g.ellipse(p.x, p.y, r * p.s, Math.max(1, Math.abs(p.y - q.y)), 0, 0, Math.PI * 2);
  g.stroke();
}

// Anything closer than this to the camera plane (or behind it) isn't drawn.
const seen = (c: Cam, x: number, y: number, z: number) => (x - c.eye.x) * c.f.x + (y - c.eye.y) * c.f.y + (z - c.eye.z) * c.f.z > 0.4;

function drawBall(g: CanvasRenderingContext2D, c: Cam, f: Frame, mode: Mode) {
  const b = f.ball;
  if (!seen(c, b.x, b.y, b.z)) return;
  const overTable = Math.abs(b.x) <= HALF_W && Math.abs(b.y) <= HALF_L;
  // Shadow on the table if it's over the table, on the floor if not.
  const sz = overTable ? 0.001 : -0.76;
  const sh = project(c, b.x, b.y, sz);
  const lift = Math.max(0, b.z - sz);
  g.fillStyle = `rgba(0,0,0,${overTable ? 0.38 - Math.min(0.25, lift * 0.5) : 0.25})`;
  g.beginPath();
  const sr = BALL_R * sh.s * (1 + lift * 0.8);
  g.ellipse(sh.x, sh.y, sr, sr * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  // Trail: where the ball was over the last few frames.
  if (f.live && f.trail.length > 1 && f.trail.every((q) => seen(c, q.x, q.y, q.z))) {
    g.lineCap = 'round';
    for (let i = 1; i < f.trail.length; i++) {
      const a = project(c, f.trail[i - 1].x, f.trail[i - 1].y, f.trail[i - 1].z), q = project(c, f.trail[i].x, f.trail[i].y, f.trail[i].z);
      g.strokeStyle = `rgba(255,170,90,${(i / f.trail.length) * 0.35})`;
      g.lineWidth = BALL_R * q.s * 1.6 * (i / f.trail.length);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(q.x, q.y); g.stroke();
    }
  }
  const p = project(c, b.x, b.y, b.z + BALL_R);
  const r = Math.max(2.5, BALL_R * p.s);
  const grad = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  grad.addColorStop(0, C.ballHi); grad.addColorStop(0.5, C.ball); grad.addColorStop(1, '#C85A10');
  g.fillStyle = grad;
  g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
  void mode;
}

// A paddle seen from behind: an oval face exactly as wide as its hitting edge, see-through so
// the ball is never hidden behind your own bat, and a short handle.
function drawPad(g: CanvasRenderingContext2D, c: Cam, x: number, y: number, side: 0 | 1, fx: Fx[]) {
  const half = PAD_HALF + PAD_R;
  const p = project(c, x, y, PAD_Z);
  const rx = half * p.s, ry = 0.085 * p.s;
  let flash = 0;
  for (const e of fx) if (e.kind === 'flash' && e.side === side) flash = Math.max(flash, 1 - e.age / e.life);
  // A shadow only while over the table; on the floor it would sit far below and look detached.
  if (Math.abs(y) <= HALF_L) {
    const sh = project(c, x, y, 0.001);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(sh.x, sh.y, rx, rx * 0.22, 0, 0, Math.PI * 2); g.fill();
  }
  // Handle.
  g.fillStyle = side === 0 ? '#C9A273' : '#B08A5E';
  const hb = project(c, x, y, PAD_Z - 0.085), he = project(c, x, y, PAD_Z - 0.17);
  g.beginPath();
  g.roundRect(hb.x - rx * 0.12, hb.y - 2, rx * 0.24, he.y - hb.y + 2, rx * 0.06);
  g.fill();
  // Face.
  g.beginPath();
  g.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  // Solid rubber; your own is a little see-through so a ball behind it still shows.
  g.fillStyle = side === 0 ? `rgba(229,72,77,${0.82 + flash * 0.18})` : flash ? '#6A7282' : C.them;
  g.fill();
  g.lineWidth = side === 0 ? Math.max(1.5, p.s * 0.006) : Math.max(2, p.s * 0.01);
  g.strokeStyle = flash ? '#FFFFFF' : side === 0 ? 'rgba(255,154,157,0.6)' : C.themRim;
  g.stroke();
}
