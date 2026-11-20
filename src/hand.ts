// Solo's view: your own bat, held flat in front of you, seen from just above and behind your
// hand. The ball rises toward you and drops back; its shadow on the rubber sits straight below
// it, as the light is overhead, and a second, softer shadow on the floor shows how far it has
// to fall. The camera drifts a little after your hand, the way your eyes would follow it.
import { BALL_R, BAT_R, FLOOR, REACH, RIM } from './juggle.ts';
import { fitCamera, project, unproject, type Cam, type Layer } from './view.ts';

export interface HandFrame {
  ball: { x: number; y: number; z: number };
  bat: { x: number; y: number; z: number };
  trail: { x: number; y: number; z: number }[];
  live: boolean;
}

export interface Pop { x: number; y: number; z: number; age: number; life: number; text: string; gold: boolean; ring: boolean }

const BLADE_RY = BAT_R * 1.05; // a real blade is a touch taller than it is wide
const PAN = 0.6; // how much of the hand's sideways move the eyes follow

const C = {
  bg0: '#0A111E', bg1: '#18243C', seam: 'rgba(170,200,255,0.05)',
  rubber: '#B8262D', rubberHi: '#D6464C', sponge: '#7A1D22', wood: '#C9A273', woodDark: '#8F6B43',
  sweet: 'rgba(255,255,255,0.12)', skin: '#D9A88A', skinLine: 'rgba(80,40,20,0.5)',
  ball: '#FF8A2A', ballHi: '#FFD2A6',
};

// Eye above and behind the hand, looking down past the bat. Fitted so the ball's flight and the
// hand's reach stay on screen. On a tall screen the fit covers only half the reach either side,
// so the bat is big; the camera pan brings the rest into view as the hand moves.
export function handCamera(w: number, h: number, dpr: number, top: number): Cam {
  const tall = h > w;
  const eye = { x: 0, y: tall ? -0.55 : -0.62, z: tall ? 0.95 : 1.05 };
  const look = { x: 0, y: 0.1, z: 0.12 };
  const rx = (tall ? REACH.x * 0.5 : REACH.x) + BAT_R + 0.03;
  const pts = [];
  for (const x of [-rx, rx]) for (const y of [-REACH.y - BAT_R, REACH.y + BAT_R]) pts.push({ x, y, z: 0 });
  for (const y of [-REACH.y, 0, REACH.y]) pts.push({ x: 0, y, z: 0.85 });
  return fitCamera(eye, look, pts, w, h, dpr, top, 0, 12);
}

// The camera for this frame: the fitted one, moved sideways after the bat. (Input keeps using
// the fitted camera, so the pan never feeds back into where the pointer puts the bat.)
export function panned(c: Cam, batX: number): Cam {
  const dx = batX * PAN;
  return { ...c, eye: { ...c.eye, x: c.eye.x + dx } };
}

export const handToWorld = (c: Cam, sx: number, sy: number) => unproject(c, sx, sy, 0);

// Only the background gradient is baked; the floor moves with the camera pan.
export function paintRoom(c: Cam, old?: Layer): Layer {
  const cv = old?.cv ?? document.createElement('canvas');
  cv.width = Math.round(c.w * c.dpr); cv.height = Math.round(c.h * c.dpr);
  const g = cv.getContext('2d')!;
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const bg = g.createLinearGradient(0, 0, 0, c.h);
  bg.addColorStop(0, C.bg0); bg.addColorStop(1, C.bg1);
  g.fillStyle = bg; g.fillRect(0, 0, c.w, c.h);
  return { cv, x: 0, y: 0 };
}

function oval(g: CanvasRenderingContext2D, c: Cam, x: number, y: number, z: number, rx: number, ry = rx) {
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2, p = project(c, x + Math.cos(a) * rx, y + Math.sin(a) * ry, z);
    if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
  }
  g.closePath();
}

function quad(g: CanvasRenderingContext2D, c: Cam, pts: [number, number, number][]) {
  g.beginPath();
  pts.forEach(([x, y, z], i) => { const p = project(c, x, y, z); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
  g.closePath();
}

export function drawHand(g: CanvasRenderingContext2D, base: Cam, room: Layer, f: HandFrame, pops: Pop[], clean: number, still: boolean) {
  const c = panned(base, f.bat.x);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(room.cv, 0, 0);
  g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  const b = f.ball, bat = f.bat;

  // The floor: a pool of light and faint boards running away from you, then the bat's own
  // soft shadow on it, which says how high above the floor your hand is.
  const mid = project(c, 0, 0.15, FLOOR);
  const glow = g.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, mid.s * 1.4);
  glow.addColorStop(0, 'rgba(120,160,230,0.16)'); glow.addColorStop(1, 'rgba(120,160,230,0)');
  g.fillStyle = glow; g.fillRect(0, 0, c.w, c.h);
  g.strokeStyle = C.seam; g.lineWidth = 1;
  g.beginPath();
  for (let i = -10; i <= 10; i++) {
    const p = project(c, i * 0.14, -0.3, FLOOR), q = project(c, i * 0.14, 3, FLOOR);
    g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
  }
  g.stroke();
  g.save();
  g.filter = `blur(${Math.max(4, mid.s * 0.03)}px)`;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  oval(g, c, bat.x, bat.y, FLOOR, BAT_R * 1.3, BLADE_RY * 1.3);
  g.fill();
  g.restore();
  const fs = project(c, b.x, b.y, FLOOR), lift = b.z - FLOOR;
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
      oval(g, c, p.x, p.y, bat.z + 0.002, still ? 0.05 : 0.02 + k * 0.07);
      g.stroke();
    }
    if (p.text) {
      // Beside the bat, clear of the ball's path.
      const q = project(c, p.x + BAT_R + 0.04, p.y, p.z + 0.02 + (still ? 0 : k * 0.06));
      g.globalAlpha = 1 - k * k;
      g.font = `800 ${Math.round(Math.max(16, q.s * 0.06))}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'left';
      g.fillStyle = p.gold ? '#FFC24D' : '#F4F7FB';
      g.fillText(p.text, q.x, q.y);
      g.globalAlpha = 1;
    }
  }
}

function drawBat(g: CanvasRenderingContext2D, c: Cam, f: HandFrame, clean: number) {
  const { x, y, z } = f.bat;
  const neck = y - BLADE_RY - RIM * 0.5; // where the blade meets the handle
  // The handle runs back toward you and off the bottom of the screen, flaring at the end,
  // with the wooden throat between it and the blade.
  const hy = neck - 0.11, endY = neck - 0.3;
  g.fillStyle = C.woodDark;
  quad(g, c, [[x - 0.015, neck + 0.01, z - 0.012], [x + 0.015, neck + 0.01, z - 0.012], [x + 0.019, endY, z - 0.07], [x - 0.019, endY, z - 0.07]]);
  g.fill();
  g.fillStyle = C.wood;
  quad(g, c, [[x - 0.014, neck + 0.01, z - 0.004], [x + 0.014, neck + 0.01, z - 0.004], [x + 0.0165, hy, z - 0.03], [x + 0.018, endY, z - 0.065], [x - 0.018, endY, z - 0.065], [x - 0.0165, hy, z - 0.03]]);
  g.fill();
  // Blade: wooden edge, then the rubber with a thin line of sponge just inside its rim.
  g.fillStyle = C.woodDark;
  oval(g, c, x, y, z - 0.007, BAT_R + RIM, BLADE_RY + RIM); g.fill();
  g.fillStyle = C.wood;
  oval(g, c, x, y, z - 0.002, BAT_R + RIM, BLADE_RY + RIM); g.fill();
  // Throat: the wood flares from the handle into the blade.
  quad(g, c, [[x - 0.023, neck + 0.012, z - 0.002], [x + 0.023, neck + 0.012, z - 0.002], [x + 0.014, neck - 0.025, z - 0.006], [x - 0.014, neck - 0.025, z - 0.006]]);
  g.fill();
  g.fillStyle = C.sponge;
  oval(g, c, x, y, z - 0.0005, BAT_R + 0.002, BLADE_RY + 0.002); g.fill();
  const ctr = project(c, x, y, z);
  const rg = g.createRadialGradient(ctr.x - ctr.s * 0.03, ctr.y - ctr.s * 0.03, 0, ctr.x, ctr.y, ctr.s * BAT_R * 1.1);
  rg.addColorStop(0, C.rubberHi); rg.addColorStop(1, C.rubber);
  g.fillStyle = rg;
  oval(g, c, x, y, z, BAT_R, BLADE_RY); g.fill();
  // The sweet spot, a faint ring; it turns gold while you're on a clean streak.
  g.strokeStyle = clean > 0 ? `rgba(255,200,90,${Math.min(0.7, 0.2 + clean * 0.06)})` : C.sweet;
  g.lineWidth = 1.5;
  oval(g, c, x, y, z + 0.001, BAT_R * 0.35); g.stroke();
  // The ball's shadow on the rubber: smaller and darker as it comes down.
  const b = f.ball, hgt = b.z - z;
  if (hgt > 0 && Math.hypot(b.x - x, b.y - y) < BAT_R + BALL_R * 2) {
    g.save();
    oval(g, c, x, y, z, BAT_R, BLADE_RY); g.clip();
    g.fillStyle = `rgba(30,0,0,${Math.max(0.18, 0.6 - hgt * 0.45)})`;
    oval(g, c, b.x, b.y, z + 0.001, BALL_R * (1 + hgt * 1.4)); g.fill();
    g.restore();
  }
  // Your thumb, resting on the rubber at the shoulder of the blade, as in a shakehand grip.
  g.fillStyle = C.skin; g.strokeStyle = C.skinLine; g.lineWidth = 1;
  oval(g, c, x + 0.022, neck + 0.022, z + 0.004, 0.017, 0.028); g.fill(); g.stroke();
}

function drawBall(g: CanvasRenderingContext2D, c: Cam, f: HandFrame) {
  const b = f.ball;
  if (f.live && f.trail.length > 1) {
    g.lineCap = 'round';
    for (let i = 1; i < f.trail.length; i++) {
      const a = project(c, f.trail[i - 1].x, f.trail[i - 1].y, f.trail[i - 1].z), q = project(c, f.trail[i].x, f.trail[i].y, f.trail[i].z);
      g.strokeStyle = `rgba(255,200,140,${(i / f.trail.length) * 0.22})`;
      g.lineWidth = BALL_R * q.s * 1.2 * (i / f.trail.length);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(q.x, q.y); g.stroke();
    }
  }
  const p = project(c, b.x, b.y, b.z);
  const r = Math.max(3, BALL_R * p.s);
  const grad = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  grad.addColorStop(0, C.ballHi); grad.addColorStop(0.5, C.ball); grad.addColorStop(1, '#C85A10');
  g.fillStyle = grad;
  g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
  // A thin dark edge keeps the orange ball distinct against the red rubber.
  g.strokeStyle = 'rgba(60,20,0,0.6)'; g.lineWidth = 1.25; g.stroke();
}
