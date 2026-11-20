import './style.css';
import { TICK, create, movePad, nextPoint, serve, winner, step, HALF_W, type Event, type Mode, type Side, type State } from './sim.ts';
import { Bot, LEVELS } from './ai.ts';
import { camera, drawFrame, paintBase, paintNet, unproject, type Cam, type Frame, type Fx, type Layer } from './view.ts';
import { courtFit, courtToWorld, courtWidthFor, drawCourt, paintCourt, type Court } from './court.ts';
import * as sfx from './audio.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
// desynchronized lets the browser skip the compositor's queue where it can: less input lag.
const g = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const TICK_MS = TICK * 1000;
const TRAIL_MS = 120;
const el = {
  prompt: $('prompt'), live: $('live'), call: $('call'), s0: $('s0'), s1: $('s1'), sv0: $('sv0'), sv1: $('sv1'),
  pts: $('pts'), best: $('best-line'), paused: $<HTMLDialogElement>('paused'), over: $<HTMLDialogElement>('over'),
};

// --- saved data ------------------------------------------------------------------------------

interface Saved { level: number; sound: boolean; best: number; record: [number, number][] }
const KEY = 'rally:v1';
const saved: Saved = { level: 1, sound: true, best: 0, record: [[0, 0], [0, 0], [0, 0]] };
// Take each stored field only if it has the right shape, so a damaged or hand-edited value
// falls back to its default instead of breaking the game.
try {
  const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Saved, unknown>>;
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (Number.isInteger(raw.level) && (raw.level as number) in LEVELS) saved.level = raw.level as number;
  if (typeof raw.sound === 'boolean') saved.sound = raw.sound;
  if (count(raw.best)) saved.best = raw.best as number;
  if (Array.isArray(raw.record) && raw.record.length === 3 && raw.record.every((r) => Array.isArray(r) && r.length === 2 && r.every(count))) saved.record = raw.record as [number, number][];
} catch { /* first visit, bad JSON or storage blocked */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: play on */ } };
sfx.setSound(saved.sound);

// --- game state ------------------------------------------------------------------------------

type Screen = 'home' | 'play' | 'paused' | 'over';
let screen: Screen = 'home';
let mode: Mode = 'match';
let s: State = create('match', 1);
let bots: Bot[] = [];
let firstServer: Side = 0;
let games = 0;
let between = 0; // seconds left in the pause after a point
let pendingEnd = false;
let stats = { longest: 0, patches: 0 };
let stopUntil = 0; // hit-stop: the sim holds still for a few ms after a hard smash
const fx: Fx[] = [];
const trail: (Frame['ball'] & { t: number })[] = [];
const history: { t: number; f: Frame }[] = []; // the last few seconds, for the slow replay
let replay: { t0: number; t1: number; at: number } | null = null;

// ?autoplay hands your paddle to a bot: for scripts/flow.ts and for watching. ?autoplay=0 is Casual.
const auto = new URLSearchParams(location.search).get('autoplay');
const autoplay = auto === null ? null : new Bot(0, LEVELS[auto !== '' && Number(auto) in LEVELS ? Number(auto) : 2], 99);

let cam: Cam; // the table, for a match
let court: Court; // the court seen from above, for Solo
let base: Layer, net: Layer | null;
let layoutKey = '';

// Room kept clear at the top for the HUD. In Solo on a landscape screen the score sits to the
// side of the court instead, so the court gets the full height.
function hudTop(w: number, h: number, scr: Screen = screen, m: Mode = mode) {
  if (scr === 'home') return 24;
  if (m === 'solo') return w > h ? 16 : 92;
  return 64;
}

function layout() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  const top = hudTop(w, h);
  // On wide screens the menu takes the left side, so the table moves over to make room.
  const left = screen === 'home' && w >= 900 && w >= h ? Math.min(520, w * 0.36) : 0;
  // Pausing and resuming change nothing here; only bake again when the picture would change.
  const key = [w, h, dpr, mode, top, left, s.halfW].join();
  if (key === layoutKey) return;
  layoutKey = key;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  if (mode === 'solo') {
    court = courtFit(w, h, dpr, top, s.halfW);
    base = paintCourt(court, base);
    net = null;
  } else {
    cam = camera(w, h, dpr, mode, top, left);
    base = paintBase(cam, mode, base);
    net = paintNet(cam, mode, net);
  }
  // A finger that's down keeps the paddle where it is under the new camera.
  if (input.down && input.touch) setTouchOffset(input.lastX, input.lastY);
}

// The menu sits over a live game between two bots.
function attract() {
  mode = 'match';
  s = create('match', (Math.random() * 1e9) | 0);
  bots = [new Bot(0, LEVELS[2], 3), new Bot(1, LEVELS[1], 4)];
  document.body.dataset.mode = 'match';
  between = 0; replay = null; pendingEnd = false; history.length = 0; trail.length = 0;
  syncPrev();
}

function start(m: Mode) {
  mode = m;
  document.body.dataset.mode = m;
  // A Solo court is as wide as this screen suits, fixed for the game even if the window changes.
  s = create(m, (Math.random() * 1e9) | 0, m === 'solo' ? courtWidthFor(innerWidth, innerHeight, hudTop(innerWidth, innerHeight, 'play', 'solo')) : undefined);
  firstServer = m === 'solo' ? 0 : (games++ % 2) as Side;
  s.server = firstServer;
  if (m === 'match') {
    const L = LEVELS[saved.level];
    bots = [new Bot(1, L, (Math.random() * 1e9) | 0)];
    $('them').textContent = L.name;
  } else bots = [];
  stats = { longest: 0, patches: 0 };
  between = 0; pendingEnd = false; replay = null; fx.length = 0; trail.length = 0; history.length = 0;
  input.samples.length = 0; input.keys.clear(); input.usingKeys = false;
  syncPrev();
  setScreen('play');
  hud(true);
  sfx.wake();
  // Keep keyboard focus in the game, not on a menu button that has just been hidden.
  canvas.focus({ preventScroll: true });
}

function setScreen(next: Screen) {
  screen = next;
  document.body.dataset.screen = next;
  $('hud').inert = next === 'home';
  $('home').inert = next !== 'home';
  if (next !== 'paused') el.paused.close();
  if (next !== 'over') el.over.close();
  if (next === 'paused') el.paused.showModal();
  layout();
  hud();
}

// --- input -----------------------------------------------------------------------------------
// Pointer samples keep their own timestamps, coalesced ones included, so each 240 Hz tick
// moves the paddle to where the finger was at that moment, not where it was at the last frame.

const input = {
  samples: [] as { t: number; x: number; y: number }[],
  id: -1, // the one pointer that steers; a second finger is ignored
  offX: 0, offY: 0, down: false, touch: false, downAt: 0, downX: 0, downY: 0, lastX: 0, lastY: 0, moved: 0,
  keys: new Set<string>(), kx: 0, ky: 0, usingKeys: false,
};

// Screen to world: onto the paddle's plane at the table, or straight down onto the court.
const toWorld = (sx: number, sy: number) => (mode === 'solo' ? courtToWorld(court, sx, sy) : unproject(cam, sx, sy));

function setTouchOffset(sx: number, sy: number) {
  // Touch moves the paddle by however far the finger moves, so the finger never covers it.
  const p = toWorld(sx, sy);
  input.offX = s.pads[0].x - p.x; input.offY = s.pads[0].y - p.y;
  input.samples.length = 0;
}

function addSample(t: number, sx: number, sy: number) {
  const p = toWorld(sx, sy);
  const smp = input.samples;
  smp.push({ t, x: p.x + input.offX, y: p.y + input.offY });
  if (smp.length > 96) smp.splice(0, smp.length - 64);
  input.usingKeys = false;
}

function targetAt(t: number) {
  const smp = input.samples;
  if (!smp.length) return null;
  if (t >= smp[smp.length - 1].t) return smp[smp.length - 1];
  for (let i = smp.length - 1; i > 0; i--) {
    const a = smp[i - 1], b = smp[i];
    if (a.t <= t) { const f = (t - a.t) / (b.t - a.t || 1); return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
  }
  return smp[0];
}

function onMove(e: PointerEvent) {
  if (screen !== 'play') return;
  if (e.pointerType === 'mouse' ? input.down && e.pointerId !== input.id : e.pointerId !== input.id) return;
  // A mouse after a touch on the same device steers directly, not with the finger's offset.
  if (e.pointerType === 'mouse' && input.touch && !input.down) { input.touch = false; input.offX = input.offY = 0; }
  const list = e.getCoalescedEvents?.() ?? [];
  for (const c of list.length ? list : [e]) addSample(c.timeStamp, c.clientX, c.clientY);
  input.lastX = e.clientX; input.lastY = e.clientY;
  if (input.down) input.moved = Math.max(input.moved, Math.hypot(e.clientX - input.downX, e.clientY - input.downY));
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (screen !== 'play' || input.down) return;
  canvas.setPointerCapture(e.pointerId);
  input.id = e.pointerId; input.down = true; input.touch = e.pointerType !== 'mouse';
  input.downAt = e.timeStamp; input.downX = input.lastX = e.clientX; input.downY = input.lastY = e.clientY; input.moved = 0;
  if (input.touch) setTouchOffset(e.clientX, e.clientY);
  else { input.offX = input.offY = 0; addSample(e.timeStamp, e.clientX, e.clientY); }
});
// pointerrawupdate arrives sooner than pointermove where it exists (Chromium).
canvas.addEventListener('onpointerrawupdate' in window ? 'pointerrawupdate' as 'pointermove' : 'pointermove', onMove);
canvas.addEventListener('pointerup', (e) => {
  if (!input.down || e.pointerId !== input.id) return;
  input.down = false;
  if (input.touch) input.id = -1;
  if (input.moved < 14 && e.timeStamp - input.downAt < 400) playerServe();
});
canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === input.id) { input.down = false; input.id = -1; } });

function playerServe() {
  if (screen !== 'play' || replay || pendingEnd || s.live || between > 0) return;
  if (mode === 'match' && s.server !== 0) return;
  serve(s, events);
  for (const e of events.splice(0)) handle(e, performance.now());
}

const KEYMAP: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
  a: [-1, 0], d: [1, 0], w: [0, 1], s: [0, -1],
};

addEventListener('keydown', (e) => {
  sfx.unlock();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (screen === 'play') {
    if (k in KEYMAP) { input.keys.add(k); e.preventDefault(); if (!input.usingKeys) { input.usingKeys = true; input.kx = s.pads[0].x; input.ky = s.pads[0].y; } }
    else if (k === ' ' || k === 'Enter') { e.preventDefault(); if (!e.repeat) playerServe(); }
    else if ((k === 'Escape' || k === 'p') && !e.repeat) { e.preventDefault(); pause(); }
  } else if (screen === 'paused' && k === 'p' && !e.repeat) resume();
});
addEventListener('keyup', (e) => { input.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });

function keyTarget() {
  let dx = 0, dy = 0;
  for (const k of input.keys) { dx += KEYMAP[k][0]; dy += KEYMAP[k][1]; }
  const l = Math.hypot(dx, dy) || 1;
  input.kx += (dx / l) * 2.8 * TICK; input.ky += (dy / l) * 2.8 * TICK;
  const p = s.pads[0];
  // Stay glued to the paddle so the target can't run off past the zone edge.
  input.kx = Math.max(p.x - 0.05, Math.min(p.x + 0.05, input.kx));
  input.ky = Math.max(p.y - 0.05, Math.min(p.y + 0.05, input.ky));
  return { x: input.kx, y: input.ky };
}

// --- the loop --------------------------------------------------------------------------------

let simT = performance.now();
let last = simT;
const events: Event[] = [];
const prevBall = { x: 0, y: 0, z: 0 };
const prevPads = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

// The interpolation start point: after a jump (new game, new point) it must be the new state,
// or one frame draws the ball halfway between the floor and the server's paddle.
function syncPrev() {
  prevBall.x = s.ball.x; prevBall.y = s.ball.y; prevBall.z = s.ball.z;
  for (let i = 0; i < 2; i++) { prevPads[i].x = s.pads[i].x; prevPads[i].y = s.pads[i].y; }
}

function tick(t: number) {
  syncPrev();
  events.length = 0;
  if (screen === 'play' && autoplay) autoplay.tick(s, events, between > 0);
  else if (screen === 'play') {
    const tgt = input.usingKeys ? keyTarget() : targetAt(t);
    if (tgt) movePad(s, 0, tgt.x, tgt.y);
    else movePad(s, 0, s.pads[0].x, s.pads[0].y);
  }
  for (const b of bots) b.tick(s, events, between > 0);
  if (between > 0) { coast(); return; }
  step(s, events);
  for (const e of events) handle(e, t);
}

// After a point the ball keeps flying for the eye; the sim waits.
function coast() {
  const b = s.ball;
  b.x += b.vx * TICK; b.y += b.vy * TICK;
  // Off the end of the table it drops to the floor and slows down.
  const off = Math.abs(b.y) > 1.6;
  const k = off ? 0.985 : 0.998;
  b.vx *= k; b.vy *= k;
  if (off) b.z = Math.max(-0.74, b.z - 3 * TICK);
}

function onHit(side: Side, speed: number, x: number) {
  sfx.paddle(speed, x / HALF_W * 0.6, side === 0);
  fx.push({ kind: 'flash', x, y: 0, age: 0, life: 0.16, side });
  if (side === 0 && screen === 'play') navigator.vibrate?.(speed > 8 ? 18 : 8);
}

function handle(e: Event, t: number) {
  if (e.t === 'hit') {
    onHit(e.side, e.speed, e.x);
    stats.longest = Math.max(stats.longest, s.hits);
    if (e.speed > 8.5 && !reduced.matches && screen === 'play') stopUntil = t + 45;
    if (mode === 'solo') hud();
  } else if (e.t === 'bounce') {
    sfx.bounce(e.speed, e.x / HALF_W * 0.6);
    fx.push({ kind: 'ring', x: e.x, y: e.y, age: 0, life: 0.35 });
  } else if (e.t === 'wall') {
    if (e.target) { sfx.patch(e.x / HALF_W * 0.6); stats.patches++; hud(); } else sfx.wall(e.speed, e.x / HALF_W * 0.6);
    fx.push({ kind: 'wall', x: e.x, y: e.y, age: 0, life: e.target ? 0.5 : 0.25, gold: e.target });
  } else if (e.t === 'point') {
    s.live = false;
    between = 1.25;
    if (screen !== 'play') { between = 0.8; return; }
    const mine = e.winner === 0;
    sfx.point(mine);
    const them = LEVELS[saved.level].name;
    const [a, b] = s.score;
    const what = e.why === 'wide' ? `${mine ? them : 'You'} hit it wide` : mine ? `${them} missed` : 'You missed';
    const tag = winner(s.score) >= 0 ? '' : a >= 10 && a === b ? 'Deuce' : a >= 10 && a > b ? 'Your game point' : b >= 10 && b > a ? `${them}’s game point` : '';
    call(tag ? `${what}\n${tag}` : what, mine);
    el.live.textContent = `${what}. You ${a}, ${them} ${b}.${tag ? ` ${tag}.` : ''}`;
    hud(false, e.winner);
    if (winner(s.score) >= 0) pendingEnd = true;
  } else if (e.t === 'out') {
    sfx.miss();
    between = 1;
    if (screen === 'play') pendingEnd = true;
    else between = 0.6;
  }
}

function afterPoint() {
  if (pendingEnd) { finish(); return; }
  if (mode === 'match') nextPoint(s, screen === 'play' ? firstServer : 0);
  if (screen !== 'play' && mode === 'match' && winner(s.score) >= 0) { s.score = [0, 0]; nextPoint(s, 0); }
  trail.length = 0;
  syncPrev();
  hud();
  if (screen === 'play' && mode === 'match' && s.server === 1) el.live.textContent = `${LEVELS[saved.level].name} to serve`;
}

let callTimer = 0;
function call(text: string, mine: boolean) {
  el.call.textContent = text;
  el.call.classList.toggle('mine', mine);
  el.call.classList.add('on');
  clearTimeout(callTimer);
  callTimer = window.setTimeout(() => el.call.classList.remove('on'), 1400);
}

// The replay: frames were recorded once per display frame, so interpolate between the two
// either side of the playback time, or slow motion steps instead of gliding.
function replayFrame(at: number): Frame | undefined {
  let i = 1;
  while (i < history.length && history[i].t < at) i++;
  if (i >= history.length) return history[history.length - 1]?.f;
  const a = history[i - 1], b = history[i];
  const k = Math.max(0, Math.min(1, (at - a.t) / (b.t - a.t || 1)));
  const l = (p: number, q: number) => p + (q - p) * k;
  return {
    ball: { x: l(a.f.ball.x, b.f.ball.x), y: l(a.f.ball.y, b.f.ball.y), z: l(a.f.ball.z, b.f.ball.z) },
    pads: [0, 1].map((j) => ({ x: l(a.f.pads[j].x, b.f.pads[j].x), y: l(a.f.pads[j].y, b.f.pads[j].y) })) as Frame['pads'],
    trail: b.f.trail, live: b.f.live, target: b.f.target,
  };
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (needLayout) { needLayout = false; layout(); }

  if (replay) {
    // Slow motion over the last couple of seconds before the end. Pausing holds it.
    if (screen === 'play') replay.at += dt * 1000 * 0.4;
    const f = replayFrame(replay.t0 + replay.at);
    if (f) draw(f, [], now / 1000);
    if (replay.t0 + replay.at >= replay.t1) { replay = null; showOver(); }
    return;
  }

  // The menu's background rally stands still for anyone who has asked for less motion.
  const running = screen === 'play' || (screen === 'home' && !reduced.matches);
  if (!running || now < stopUntil) { simT = now; }
  else {
    if (now - simT > 250) simT = now - 250;
    while (simT + TICK_MS <= now) {
      simT += TICK_MS;
      tick(simT);
      if (between > 0 && (between -= TICK) <= 0) { between = 0; afterPoint(); }
      // A hard hit freezes the picture on the contact itself, not a few ticks after it.
      if (screen === 'over' || replay || simT < stopUntil) break;
    }
  }

  for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].age += dt) > fx[i].life) fx.splice(i, 1);
  // Draw between the last two ticks so motion stays smooth at any refresh rate.
  const a = running ? Math.max(0, Math.min(1, (now - simT) / TICK_MS)) : 1;
  const b = s.ball, lerp = (p: number, q: number) => p + (q - p) * a;
  const ball = { x: lerp(prevBall.x, b.x), y: lerp(prevBall.y, b.y), z: lerp(prevBall.z, b.z) };
  const pads = [0, 1].map((i) => ({ x: lerp(prevPads[i].x, s.pads[i].x), y: lerp(prevPads[i].y, s.pads[i].y) })) as Frame['pads'];
  // The trail covers a fixed 120 ms, so it's the same length at 60 Hz and 120 Hz.
  if (s.live || between > 0) {
    trail.push({ ...ball, t: now });
    while (trail.length && trail[0].t < now - TRAIL_MS) trail.shift();
  } else trail.length = 0;
  const f: Frame = { ball, pads, trail: trail.slice(), live: s.live || between > 0, target: s.target };
  if (screen === 'play') {
    history.push({ t: now, f });
    while (history.length && history[0].t < now - 2600) history.shift();
  }
  draw(f, fx, now / 1000);
  prompt();
}

function draw(f: Frame, effects: Fx[], t: number) {
  if (mode === 'solo') drawCourt(g, court, base, f, effects, t);
  else drawFrame(g, cam, mode, base, net, f, effects, t);
}

let promptText = '';
function prompt() {
  const show = screen === 'play' && !replay && !pendingEnd && !s.live && between <= 0 && (mode === 'solo' || s.server === 0);
  const text = show ? (coarse.matches ? 'Tap to serve' : 'Click or press Space to serve') : '';
  if (text === promptText) return;
  if (text) { el.prompt.textContent = text; el.live.textContent = 'Your serve'; }
  el.prompt.classList.toggle('on', !!text);
  promptText = text;
}

// --- HUD, pause, end -------------------------------------------------------------------------

function hud(fresh = false, scored: Side | -1 = -1) {
  if (mode === 'match') {
    el.s0.textContent = String(s.score[0]);
    el.s1.textContent = String(s.score[1]);
    const sv = screen === 'play' && !pendingEnd ? s.server : -1;
    el.sv0.classList.toggle('on', sv === 0);
    el.sv1.classList.toggle('on', sv === 1);
    if (scored >= 0) { const b = scored ? el.s1 : el.s0; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  } else {
    el.pts.textContent = String(s.points);
    el.best.textContent = saved.best ? `Best ${Math.max(saved.best, s.points)}` : '';
  }
  if (fresh) {
    saved.record.forEach(([w, l], i) => { $(`rec${i}`).textContent = w + l ? `${w}–${l}` : ''; });
    $('solo-best').textContent = saved.best ? `Best ${saved.best}` : '';
  }
}

function pause() {
  if (screen !== 'play') return;
  // A key held when focus left would otherwise stay "down" forever: its keyup went elsewhere.
  input.keys.clear(); input.down = false; if (input.touch) input.id = -1;
  setScreen('paused');
  sfx.sleep();
}
function resume() { setScreen('play'); simT = performance.now(); sfx.wake(); canvas.focus({ preventScroll: true }); }

function finish() {
  pendingEnd = false;
  between = 0;
  // Watch the last two seconds again, slowly, then the result.
  if (history.length > 10 && !reduced.matches) {
    const t1 = history[history.length - 1].t;
    replay = { t0: Math.max(history[0].t, t1 - 1800), t1, at: 0 };
  } else showOver();
}

function showOver() {
  setScreen('over');
  const k = $('over-k'), h = $('over-h'), dl = $('over-stats');
  const rows: [string, string][] = [];
  k.className = 'kicker';
  if (mode === 'match') {
    const L = LEVELS[saved.level];
    const won = winner(s.score) === 0;
    saved.record[saved.level][won ? 0 : 1]++;
    k.textContent = `Against ${L.name}`;
    h.textContent = won ? `You won ${s.score[0]}–${s.score[1]}` : `${L.name} won ${s.score[1]}–${s.score[0]}`;
    const [w, l] = saved.record[saved.level];
    rows.push(['Longest rally', `${stats.longest} shots`], [`Record against ${L.name}`, `${w}–${l}`]);
  } else {
    const best = s.points > saved.best;
    if (best) { saved.best = s.points; k.textContent = 'New best'; k.classList.add('good'); }
    else k.textContent = saved.best ? `Best ${saved.best}` : 'Solo';
    h.textContent = `${s.points} ${s.points === 1 ? 'point' : 'points'}`;
    // s.hits counts the serve too.
    rows.push(['Returns', String(Math.max(0, s.hits - 1))], ['Lit patches', String(stats.patches)]);
  }
  save();
  dl.replaceChildren(...rows.flatMap(([a, b]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = a; dd.textContent = b; return [dt, dd]; }));
  el.over.showModal();
  hud(true);
}

function menu() {
  attract();
  setScreen('home');
  hud(true);
  sfx.wake();
  document.querySelector<HTMLButtonElement>(`.levels button[data-level="${saved.level}"]`)?.focus({ preventScroll: true });
}

$('go-solo').addEventListener('click', () => { sfx.unlock(); start('solo'); });
$('pause').addEventListener('click', pause);
for (const b of document.querySelectorAll<HTMLButtonElement>('.levels button')) {
  b.addEventListener('click', () => { sfx.unlock(); saved.level = Number(b.dataset.level); save(); start('match'); });
}
const snd = $<HTMLInputElement>('sound');
snd.checked = saved.sound;
snd.addEventListener('change', () => { saved.sound = snd.checked; sfx.setSound(snd.checked); save(); if (snd.checked) { sfx.unlock(); sfx.paddle(5, 0, true); } });

for (const d of [el.paused, el.over]) {
  d.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'resume') resume();
    else if (act === 'restart' || act === 'again') start(mode);
    else if (act === 'menu') menu();
  });
  // Escape on the pause dialog resumes; on the result it goes to the menu.
  d.addEventListener('cancel', (e) => { e.preventDefault(); if (d.id === 'paused') resume(); else menu(); });
}

// Resize fires many times during a drag or rotation, so it only sets a flag; frame() lays out
// before it draws. (Laying out in a later rAF callback would clear the canvas after the draw.)
let needLayout = false;
addEventListener('resize', () => { needLayout = true; });
// Moving the window to a screen with a different pixel density fires no resize.
function watchDpr() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { needLayout = true; watchDpr(); }, { once: true });
}
watchDpr();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); sfx.sleep(); } else if (screen === 'home') sfx.wake();
});
addEventListener('blur', () => pause());

attract();
setScreen('home');
hud(true);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js');

// For scripts/flow.ts.
(window as unknown as { __rally: () => unknown }).__rally = () => ({ s, screen, mode, between, stats, replay: !!replay, bots: bots.map((b) => ({ tx: b.tx, ty: b.ty })) });
