// Solo's view: your own bat, held flat in front of you, seen from just above and behind your
// hand. The ball rises toward you and drops back. Its shadow on the rubber shows where it will
// land, which is the cue you play by; a second, fainter shadow on the floor shows where it
// would fall if you missed.
import { BALL_R, BAT_R, FLOOR, REACH, RIM } from './juggle.ts';
import { fitCamera, project, unproject, type Cam, type Layer } from './view.ts';

export interface HandFrame {
  ball: { x: number; y: number; z: number };
  bat: { x: number; y: number; z: number };
  trail: { x: number; y: number; z: number }[];
  live: boolean;
}

export interface Pop { x: number; y: number; z: number; age: number; life: number; text: string; gold: boolean; ring: boolean }

const HANDLE = 0.11; // handle length past the blade

const C = {
  bg0: '#0B1220', bg1: '#16233D', floor: '#0F1A2E', grid: 'rgba(170,200,255,0.07)',
  rubber: '#D93A40', rubberHi: '#F0646A', wood: '#C9A273', woodDark: '#8F6B43', sweet: 'rgba(255,255,255,0.10)',
  ball: '#FF8A2A', ballHi: '#FFD2A6',
};

// Eye above and behind the hand, looking down past the bat. Fit the hand's reach and the
// height of a high ball into the screen.
export function handCamera(w: number, h: number, dpr: number, top: number): Cam {
  const eye = { x: 0, y: -0.62, z: 1.05 };
  const look = { x: 0, y: 0.1, z: 0.12 };
  const pts = [];
  for (const x of [-REACH.x - BAT_R - 0.03, REACH.x + BAT_R + 0.03]) for (const y of [-REACH.y - BAT_R, REACH.y + BAT_R]) pts.push({ x, y, z: 0 });
  pts.push({ x: 0, y: 0, z: 0.8 }, { x: 0, y: -REACH.y - BAT_R - HANDLE, z: 0 });
  return fitCamera(eye, look, pts, w, h, dpr, top, 0, 12);
}

export const handToWorld = (c: Cam, sx: number, sy: number) => unproject(c, sx, sy, 0);

// The floor far below, with a grid in perspective so depth reads: baked once per resize.
export function paintRoom(c: Cam, old?: Layer): Layer {
  const cv = old?.cv ?? document.createElement('canvas');
  cv.width = Math.round(c.w * c.dpr); cv.height = Math.round(c.h * c.dpr);
  const g = cv.getContext('2d')!;
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const bg = g.createLinearGradient(0, 0, 0, c.h);
  bg.addColorStop(0, C.bg0); bg.addColorStop(1, C.bg1);
  g.fillStyle = bg; g.fillRect(0, 0, c.w, c.h);
  // A pool of light on the floor under the bat.
  const mid = project(c, 0, 0.1, FLOOR);
  const glow = g.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, mid.s * 1.6);
  glow.addColorStop(0, 'rgba(120,160,230,0.18)'); glow.addColorStop(1, 'rgba(120,160,230,0)');
  g.fillStyle = glow; g.fillRect(0, 0, c.w, c.h);
  g.strokeStyle = C.grid; g.lineWidth = 1;
  g.beginPath();
  for (let i = -6; i <= 6; i++) {
    const a = project(c, i * 0.25, -0.6, FLOOR), b = project(c, i * 0.25, 2.5, FLOOR);
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
  }
  for (let j = 0; j <= 12; j++) {
    const y = -0.6 + j * 0.25;
    const a = project(c, -1.5, y, FLOOR), b = project(c, 1.5, y, FLOOR);
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
  }
  g.stroke();
  // Fade the far floor into the background.
  const far = g.createLinearGradient(0, 0, 0, project(c, 0, 0.5, FLOOR).y);
  far.addColorStop(0, C.bg0); far.addColorStop(1, 'rgba(11,18,32,0)');
  g.fillStyle = far; g.fillRect(0, 0, c.w, c.h);
  return { cv, x: 0, y: 0 };
}

function disc(g: CanvasRenderingContext2D, c: Cam, x: number, y: number, z: number, r: number) {
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2, p = project(c, x + Math.cos(a) * r, y + Math.sin(a) * r, z);
    if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
  }
  g.closePath();
}

export function drawHand(g: CanvasRenderingContext2D, c: Cam, room: Layer, f: HandFrame, pops: Pop[], clean: number) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(room.cv, 0, 0);
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const b = f.ball, bat = f.bat;

  // Where the ball would hit the floor.
  const fs = project(c, b.x, b.y, FLOOR);
  const lift = b.z - FLOOR;
  g.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.3 - lift * 0.08)})`;
  g.beginPath(); g.ellipse(fs.x, fs.y, BALL_R * fs.s * (1 + lift * 0.6), BALL_R * fs.s * 0.5 * (1 + lift * 0.6), 0, 0, Math.PI * 2); g.fill();

  const below = b.z < bat.z;
  if (below) drawBall(g, c, f);
  drawBat(g, c, f, clean);
  if (!below) drawBall(g, c, f);

  for (const p of pops) {
    const k = p.age / p.life;
    if (p.ring) {
      g.strokeStyle = p.gold ? `rgba(255,200,90,${0.9 * (1 - k)})` : `rgba(255,255,255,${0.6 * (1 - k)})`;
      g.lineWidth = 2;
      disc(g, c, p.x, p.y, bat.z + 0.002, 0.02 + k * 0.07);
      g.stroke();
    }
    if (p.text) {
      const q = project(c, p.x, p.y, p.z + 0.08 + k * 0.12);
      g.globalAlpha = 1 - k * k;
      g.font = `800 ${Math.round(Math.max(16, q.s * 0.07))}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = p.gold ? '#FFC24D' : '#F4F7FB';
      g.fillText(p.text, q.x, q.y);
      g.globalAlpha = 1;
    }
  }
}

function drawBat(g: CanvasRenderingContext2D, c: Cam, f: HandFrame, clean: number) {
  const { x, y, z } = f.bat;
  // The handle points back at you, with a rounded end where your hand would be.
  const h0 = project(c, x, y - BAT_R, z - 0.004), h1 = project(c, x, y - BAT_R - RIM - HANDLE, z - 0.01);
  g.lineCap = 'round';
  g.strokeStyle = C.woodDark; g.lineWidth = Math.max(8, h1.s * 0.03);
  g.beginPath(); g.moveTo(h0.x, h0.y + 1.5); g.lineTo(h1.x, h1.y + 1.5); g.stroke();
  g.strokeStyle = C.wood; g.lineWidth = Math.max(7, h1.s * 0.026);
  g.beginPath(); g.moveTo(h0.x, h0.y); g.lineTo(h1.x, h1.y); g.stroke();
  // The blade: wooden edge, then the rubber face on top.
  g.fillStyle = C.woodDark;
  disc(g, c, x, y, z - 0.007, BAT_R + RIM); g.fill();
  g.fillStyle = C.wood;
  disc(g, c, x, y, z - 0.002, BAT_R + RIM); g.fill();
  const ctr = project(c, x, y, z);
  const rg = g.createRadialGradient(ctr.x - ctr.s * 0.03, ctr.y - ctr.s * 0.03, 0, ctr.x, ctr.y, ctr.s * BAT_R * 1.1);
  rg.addColorStop(0, C.rubberHi); rg.addColorStop(1, C.rubber);
  g.fillStyle = rg;
  disc(g, c, x, y, z, BAT_R); g.fill();
  // The sweet spot, a faint ring; it brightens while you're on a clean streak.
  g.strokeStyle = clean > 0 ? `rgba(255,200,90,${Math.min(0.6, 0.15 + clean * 0.06)})` : C.sweet;
  g.lineWidth = 1.5;
  disc(g, c, x, y, z + 0.001, BAT_R * 0.35); g.stroke();
  // The ball's shadow on the rubber: smaller and darker as it comes down.
  const b = f.ball;
  const hgt = b.z - z;
  if (hgt > 0 && Math.hypot(b.x - x, b.y - y) < BAT_R + BALL_R * 2) {
    g.save();
    disc(g, c, x, y, z, BAT_R); g.clip();
    g.fillStyle = `rgba(40,0,0,${Math.max(0.15, 0.55 - hgt * 0.45)})`;
    disc(g, c, b.x, b.y, z + 0.001, BALL_R * (1 + hgt * 1.4)); g.fill();
    g.restore();
  }
}

function drawBall(g: CanvasRenderingContext2D, c: Cam, f: HandFrame) {
  const b = f.ball;
  if (f.live && f.trail.length > 1) {
    g.lineCap = 'round';
    for (let i = 1; i < f.trail.length; i++) {
      const a = project(c, f.trail[i - 1].x, f.trail[i - 1].y, f.trail[i - 1].z), q = project(c, f.trail[i].x, f.trail[i].y, f.trail[i].z);
      g.strokeStyle = `rgba(255,170,90,${(i / f.trail.length) * 0.3})`;
      g.lineWidth = BALL_R * q.s * 1.6 * (i / f.trail.length);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(q.x, q.y); g.stroke();
    }
  }
  const p = project(c, b.x, b.y, b.z);
  const r = Math.max(3, BALL_R * p.s);
  const grad = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  grad.addColorStop(0, C.ballHi); grad.addColorStop(0.5, C.ball); grad.addColorStop(1, '#C85A10');
  g.fillStyle = grad;
  g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
}
