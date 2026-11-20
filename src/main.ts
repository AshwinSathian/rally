import './style.css';
import { TICK, create, movePad, nextPoint, serve, winner, step, HALF_W, type Event, type Mode, type Side, type State } from './sim.ts';
import { Bot, LEVELS } from './ai.ts';
import { camera, drawFrame, paintBase, paintNet, unproject, type Cam, type Frame, type Fx } from './view.ts';
import * as sfx from './audio.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
// desynchronized lets the browser skip the compositor's queue where it can: less input lag.
const g = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const TICK_MS = TICK * 1000;

// --- saved data ------------------------------------------------------------------------------

interface Saved { level: number; sound: boolean; best: number; record: [number, number][] }
const KEY = 'rally:v1';
const saved: Saved = { level: 1, sound: true, best: 0, record: [[0, 0], [0, 0], [0, 0]] };
try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* first visit or storage blocked */ }
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
let stats = { rally: 0, longest: 0, patches: 0 };
let stopUntil = 0; // hit-stop: the sim holds still for a few ms after a hard smash
const fx: Fx[] = [];
const trail: Frame['trail'] = [];
const history: { t: number; f: Frame }[] = []; // the last few seconds, for the slow replay
let replay: { t0: number; t1: number; at: number } | null = null;

// ?autoplay hands your paddle to a bot: for scripts/flow.ts and for watching.
const auto = new URLSearchParams(location.search).get('autoplay');
const autoplay = auto === null ? null : new Bot(0, LEVELS[auto !== '' && Number(auto) in LEVELS ? Number(auto) : 2], 99);

let cam: Cam;
let base: HTMLCanvasElement, net: HTMLCanvasElement;

function layout() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const top = screen === 'home' ? 24 : mode === 'solo' ? 92 : 64;
  // On wide screens the menu takes the left side, so the table moves over to make room.
  const left = screen === 'home' && w >= 900 && w >= h ? Math.min(520, w * 0.36) : 0;
  cam = camera(w, h, dpr, mode, top, left);
  base = paintBase(cam, mode);
  net = paintNet(cam, mode);
}

// The menu sits over a live game between two bots.
function attract() {
  mode = 'match';
  s = create('match', (Math.random() * 1e9) | 0);
  bots = [new Bot(0, LEVELS[2], 3), new Bot(1, LEVELS[1], 4)];
  document.body.dataset.mode = 'match';
  between = 0; replay = null;
}

function start(m: Mode) {
  mode = m;
  document.body.dataset.mode = m;
  s = create(m, (Math.random() * 1e9) | 0);
  firstServer = (games++ % 2) as Side;
  s.server = m === 'solo' ? 0 : firstServer;
  if (m === 'match') {
    const L = LEVELS[saved.level];
    bots = [new Bot(1, L, (Math.random() * 1e9) | 0)];
    $('them').textContent = L.name;
  } else bots = [];
  // Put the paddle where the pointer last was so the first frame doesn't jump.
  s.pads[0].x = s.pads[0].px = 0;
  stats = { rally: 0, longest: 0, patches: 0 };
  between = 0; pendingEnd = false; replay = null; fx.length = 0; trail.length = 0; history.length = 0;
  input.samples.length = 0;
  setScreen('play');
  hud(true);
}

function setScreen(next: Screen) {
  screen = next;
  document.body.dataset.screen = next;
  if (next !== 'paused') $<HTMLDialogElement>('paused').close();
  if (next !== 'over') $<HTMLDialogElement>('over').close();
  if (next === 'paused') $<HTMLDialogElement>('paused').showModal();
  layout();
  hud();
}

// --- input -----------------------------------------------------------------------------------
// Pointer samples keep their own timestamps, coalesced ones included, so each 240 Hz tick
// moves the paddle to where the finger was at that moment, not where it was at the last frame.

const input = {
  samples: [] as { t: number; x: number; y: number }[],
  offX: 0, offY: 0, down: false, downAt: 0, downX: 0, downY: 0, moved: 0,
  keys: new Set<string>(), kx: 0, ky: 0, usingKeys: false,
};

function addSample(t: number, sx: number, sy: number) {
  const p = unproject(cam, sx, sy);
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
  if (e.pointerType !== 'mouse' && !input.down) return;
  const list = e.getCoalescedEvents?.() ?? [];
  for (const c of list.length ? list : [e]) addSample(c.timeStamp, c.clientX, c.clientY);
  input.moved = Math.max(input.moved, Math.hypot(e.clientX - input.downX, e.clientY - input.downY));
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (screen !== 'play') return;
  canvas.setPointerCapture(e.pointerId);
  input.down = true; input.downAt = e.timeStamp; input.downX = e.clientX; input.downY = e.clientY; input.moved = 0;
  if (e.pointerType === 'mouse') { input.offX = input.offY = 0; }
  else {
    // Touch moves the paddle by however far the finger moves, so the finger never covers it.
    const p = unproject(cam, e.clientX, e.clientY);
    input.offX = s.pads[0].x - p.x; input.offY = s.pads[0].y - p.y;
  }
  addSample(e.timeStamp, e.clientX, e.clientY);
});
// pointerrawupdate arrives sooner than pointermove where it exists (Chromium).
canvas.addEventListener('onpointerrawupdate' in window ? 'pointerrawupdate' as 'pointermove' : 'pointermove', onMove);
const release = (e: PointerEvent) => {
  if (!input.down) return;
  input.down = false;
  if (screen === 'play' && input.moved < 14 && e.timeStamp - input.downAt < 400) playerServe();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => { input.down = false; });

function playerServe() {
  if (screen !== 'play' || s.live || between > 0) return;
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
    else if (k === ' ' || k === 'Enter') { e.preventDefault(); playerServe(); }
    else if (k === 'Escape' || k === 'p') { e.preventDefault(); pause(); }
  } else if (screen === 'paused' && (k === 'p')) resume();
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
let prevBall = { x: 0, y: 0, z: 0 };
let prevPads = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

function tick(t: number) {
  prevBall = { x: s.ball.x, y: s.ball.y, z: s.ball.z };
  prevPads = [{ x: s.pads[0].x, y: s.pads[0].y }, { x: s.pads[1].x, y: s.pads[1].y }];
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
    stats.rally = s.hits;
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
    const who = e.winner === 0 ? them : 'You';
    const [a, b] = s.score;
    const tag = winner(s.score) >= 0 ? '' : a >= 10 && a === b ? ' · Deuce' : a >= 10 && a > b ? ' · Game point' : b >= 10 && b > a ? ` · Game point ${them}` : '';
    call((e.why === 'wide' ? `${who} hit it wide` : who === 'You' ? 'You missed' : `${them} missed`) + tag, mine);
    hud(true, e.winner);
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
  hud();
}

let callTimer = 0;
function call(text: string, mine: boolean) {
  const el = $('call');
  el.textContent = text;
  el.classList.toggle('mine', mine);
  el.classList.add('on');
  clearTimeout(callTimer);
  callTimer = window.setTimeout(() => el.classList.remove('on'), 1400);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!cam) return;

  if (replay) {
    // Slow motion over the last couple of seconds before the end.
    replay.at += dt * 1000 * 0.4;
    const at = replay.t0 + replay.at;
    let f = history[history.length - 1]?.f;
    for (const h of history) if (h.t >= at) { f = h.f; break; }
    if (f) drawFrame(g, cam, mode, base, net, f, [], now / 1000);
    if (at >= replay.t1) { replay = null; showOver(); }
    return;
  }

  const running = screen === 'play' || screen === 'home';
  if (!running) { simT = now; }
  else if (now < stopUntil) { simT = now; }
  else {
    if (now - simT > 250) simT = now - 250;
    while (simT + TICK_MS <= now) {
      simT += TICK_MS;
      tick(simT);
      if (between > 0 && (between -= TICK) <= 0) { between = 0; afterPoint(); }
      if (screen === 'over' || replay) break;
    }
  }

  for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].age += dt) > fx[i].life) fx.splice(i, 1);
  // Draw between the last two ticks so motion stays smooth at any refresh rate.
  const a = running ? Math.max(0, Math.min(1, (now - simT) / TICK_MS)) : 1;
  const b = s.ball, lerp = (p: number, q: number) => p + (q - p) * a;
  const ball = { x: lerp(prevBall.x, b.x), y: lerp(prevBall.y, b.y), z: lerp(prevBall.z, b.z) };
  const pads = [0, 1].map((i) => ({ x: lerp(prevPads[i].x, s.pads[i].x), y: lerp(prevPads[i].y, s.pads[i].y) })) as Frame['pads'];
  if (s.live || between > 0) { trail.push(ball); if (trail.length > 8) trail.shift(); } else trail.length = 0;
  const f: Frame = { ball, pads, trail: trail.slice(), live: s.live || between > 0, target: s.target };
  if (screen === 'play') {
    history.push({ t: now, f });
    while (history.length && history[0].t < now - 2600) history.shift();
  }
  drawFrame(g, cam, mode, base, net, f, fx, now / 1000);
  prompt();
}

function prompt() {
  const el = $('prompt');
  const touch = matchMedia('(pointer: coarse)').matches;
  const show = screen === 'play' && !s.live && between <= 0 && (mode === 'solo' || s.server === 0);
  if (show) el.textContent = touch ? 'Tap to serve' : 'Click or press Space to serve';
  if (show && !el.classList.contains('on')) $('live').textContent = 'Your serve';
  el.classList.toggle('on', show);
}

// --- HUD, pause, end -------------------------------------------------------------------------

function hud(fresh = false, scored: Side | -1 = -1) {
  if (mode === 'match') {
    $('s0').textContent = String(s.score[0]);
    $('s1').textContent = String(s.score[1]);
    const sv = screen === 'play' && !pendingEnd ? s.server : -1;
    $('sv0').classList.toggle('on', sv === 0);
    $('sv1').classList.toggle('on', sv === 1);
    if (scored >= 0) { const el = $(`s${scored}`); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    if (scored >= 0) $('live').textContent = `You ${s.score[0]}, ${LEVELS[saved.level].name} ${s.score[1]}`;
  } else {
    $('pts').textContent = String(s.points);
    $('best-line').textContent = saved.best ? `Best ${Math.max(saved.best, s.points)}` : '';
  }
  if (fresh) {
    saved.record.forEach(([w, l], i) => { $(`rec${i}`).textContent = w + l ? `${w}–${l}` : ''; });
    $('solo-best').textContent = saved.best ? `Best ${saved.best}` : '';
  }
}

function pause() {
  if (screen !== 'play') return;
  setScreen('paused');
}
function resume() { setScreen('play'); simT = performance.now(); }

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
    $('live').textContent = h.textContent;
  } else {
    const best = s.points > saved.best;
    if (best) { saved.best = s.points; k.textContent = 'New best'; k.classList.add('good'); }
    else k.textContent = saved.best ? `Best ${saved.best}` : 'Solo';
    h.textContent = `${s.points} ${s.points === 1 ? 'point' : 'points'}`;
    rows.push(['Returns', String(s.hits)], ['Lit patches', String(stats.patches)]);
    $('live').textContent = `Out. ${h.textContent}${best ? ', a new best' : ''}`;
  }
  save();
  dl.replaceChildren(...rows.flatMap(([a, b]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = a; dd.textContent = b; return [dt, dd]; }));
  $<HTMLDialogElement>('over').showModal();
  hud(true);
}

function menu() {
  attract();
  setScreen('home');
  hud(true);
  document.querySelector<HTMLButtonElement>(`.levels button[data-level="${saved.level}"]`)!.focus({ preventScroll: true });
}

$('go-solo').addEventListener('click', () => { sfx.unlock(); start('solo'); });
$('pause').addEventListener('click', pause);
for (const b of document.querySelectorAll<HTMLButtonElement>('.levels button')) {
  b.addEventListener('click', () => { sfx.unlock(); saved.level = Number(b.dataset.level); save(); start('match'); });
}
const snd = $<HTMLInputElement>('sound');
snd.checked = saved.sound;
snd.addEventListener('change', () => { saved.sound = snd.checked; sfx.setSound(snd.checked); save(); if (snd.checked) { sfx.unlock(); sfx.paddle(5, 0, true); } });

for (const d of [$<HTMLDialogElement>('paused'), $<HTMLDialogElement>('over')]) {
  d.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'resume') resume();
    else if (act === 'restart' || act === 'again') start(mode);
    else if (act === 'menu') menu();
  });
  // Escape on the pause dialog resumes; on the result it goes to the menu.
  d.addEventListener('cancel', (e) => { e.preventDefault(); if (d.id === 'paused') resume(); else menu(); });
}

addEventListener('resize', () => layout());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', () => pause());

attract();
layout();
hud(true);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js');

// For scripts/flow.ts.
(window as unknown as { __rally: () => unknown }).__rally = () => ({ s, screen, mode, between, stats, replay: !!replay, bots: bots.map((b) => ({ tx: b.tx, ty: b.ty })) });
