import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimFor, create, landX, movePad, nextPoint, serve, serverFor, step, sweep, winner, HALF_L, HALF_W, BALL_R, PAD_HALF, PAD_R, type Event, type State } from './sim.ts';
import { Bot, LEVELS, predict } from './ai.ts';

// Reference for sweep(): walk the step in a million tiny pieces and report the first overlap.
function brute(x: number, y: number, dx: number, dy: number, h: number, r: number) {
  const N = 20000;
  for (let i = 0; i <= N; i++) {
    const t = i / N, px = x + dx * t, py = y + dy * t;
    const cx = Math.max(-h, Math.min(h, px));
    if ((px - cx) ** 2 + py * py <= r * r) return t;
  }
  return -1;
}

test('sweep finds the first contact, at any speed', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let hits = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (rnd() - 0.5) * 1, y = (rnd() - 0.5) * 1;
    const s = rnd() < 0.5 ? 0.05 : 3; // up to 3 m in one step, far past any real speed
    const dx = (rnd() - 0.5) * s, dy = (rnd() - 0.5) * s;
    const t = sweep(x, y, dx, dy, 0.13, 0.048);
    const ref = brute(x, y, dx, dy, 0.13, 0.048);
    if (ref < 0) { assert.equal(t, -1, `false hit at case ${i}`); continue; }
    hits++;
    assert.ok(t >= 0, `missed contact at case ${i}`);
    assert.ok(t <= ref + 1e-9 && t >= ref - 1 / 20000 - 1e-9, `case ${i}: ${t} vs ${ref}`);
  }
  assert.ok(hits > 300);
});

test('a ball never passes through a paddle, however fast both move', () => {
  // One tick at a time: a random paddle move and a random incoming ball, up to 40 m/s for the
  // ball and 60 m/s for the paddle. If the fine-grained reference sees them touch, step() must hit.
  let seed = 11, touched = 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 20000; k++) {
    const s = create('match', 1);
    s.live = true;
    const p = s.pads[0];
    p.x = (rnd() - 0.5) * 0.8; p.y = -HALF_L - 0.2;
    const b = s.ball;
    Object.assign(b, { x: p.x + (rnd() - 0.5) * 0.6, y: p.y + (rnd() - 0.3) * 0.4, vx: (rnd() - 0.5) * 20, vy: -rnd() * 40, curve: 0, bounced: true, bounceY: -99 });
    const tx = p.x + (rnd() - 0.5) * 0.5, ty = p.y + (rnd() - 0.5) * 0.25;
    movePad(s, 0, tx, ty);
    const dx = b.vx / 240, dy = b.vy / 240;
    const ref = brute(b.x - p.px, b.y - p.py, dx - (p.x - p.px), dy - (p.y - p.py), PAD_HALF, BALL_R + PAD_R);
    const ev: Event[] = [];
    step(s, ev);
    const hit = ev.some((e) => e.t === 'hit');
    if (ref >= 0) { touched++; assert.ok(hit, `case ${k}: touched at ${ref} but no hit`); }
    if (hit) assert.ok(s.ball.vy > 0, `case ${k}: returned the wrong way`);
  }
  assert.ok(touched > 2000, `only ${touched} contacts`);
});

test('scoring: eleven, win by two, serve every two and every one at deuce', () => {
  assert.equal(winner([11, 9]), 0);
  assert.equal(winner([11, 10]), -1);
  assert.equal(winner([12, 14]), 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => serverFor([n, 0], 0)), [0, 0, 1, 1, 0, 0]);
  assert.equal(serverFor([10, 10], 0), 0);
  assert.equal(serverFor([11, 10], 0), 1);
  assert.equal(serverFor([11, 11], 0), 0);
  assert.equal(serverFor([3, 2], 1), 1);
});

test('predict matches the simulation exactly, curve included', () => {
  const s = create('match', 9);
  s.live = true;
  Object.assign(s.ball, { x: 0.1, y: -0.5, vx: 0.4, vy: 5, curve: 1.2, bounceY: 99, bounced: true });
  s.pads[1].y = s.pads[1].py = 50; // out of the way
  const want = predict(s.ball, HALF_L + 0.14)!;
  const ev: Event[] = [];
  let prev = { ...s.ball };
  while (s.ball.y < HALF_L + 0.14) { prev = { ...s.ball }; step(s, ev); }
  const f = (HALF_L + 0.14 - prev.y) / (s.ball.y - prev.y);
  assert.ok(Math.abs(prev.x + (s.ball.x - prev.x) * f - want.x) < 1e-9);
});

function match(a: number, b: number, seed: number) {
  const s = create('match', seed);
  const bots = [new Bot(0, LEVELS[a], seed * 3 + 1), new Bot(1, LEVELS[b], seed * 7 + 2)];
  const ev: Event[] = [];
  let rallies = 0, shots = 0, ticks = 0, sinceLive = 0;
  while (winner(s.score) < 0) {
    bots[0].tick(s); bots[1].tick(s);
    ev.length = 0;
    step(s, ev);
    ticks++;
    sinceLive = s.live ? sinceLive + 1 : 0;
    assert.ok(sinceLive < 240 * 60, 'a rally ran a minute');
    for (const e of ev) {
      if (e.t === 'hit') shots++;
      if (e.t === 'point') { rallies++; nextPoint(s, 0); }
    }
    assert.ok(ticks < 240 * 3600, 'a match ran an hour');
  }
  return { w: winner(s.score), score: s.score, shots: shots / rallies };
}

test('bots finish matches, and better bots win', () => {
  let proWins = 0, clubWins = 0;
  for (let i = 0; i < 20; i++) {
    if (match(2, 0, i + 1).w === 0) proWins++;
    if (match(1, 0, i + 101).w === 0) clubWins++;
  }
  assert.ok(proWins >= 18, `Pro beat Casual ${proWins}/20`);
  assert.ok(clubWins >= 14, `Club beat Casual ${clubWins}/20`);
});

test('solo: the ball stays inside the walls', () => {
  for (let k = 0; k < 200; k++) {
    const s: State = create('solo', k + 5);
    s.live = true;
    const a = (k / 200) * Math.PI * 2;
    Object.assign(s.ball, { x: 0, y: 0, vx: Math.cos(a) * 11, vy: Math.abs(Math.sin(a)) * 11 + 0.5, curve: (k % 5 - 2) * 0.8 });
    s.pads[0].y = s.pads[0].py = -99; // no paddle: let it fall out
    const ev: Event[] = [];
    for (let i = 0; i < 240 * 10 && s.live; i++) {
      step(s, ev);
      assert.ok(Math.abs(s.ball.x) <= HALF_W - BALL_R + 1e-9, `escaped sideways ${k}`);
      assert.ok(s.ball.y <= HALF_L - BALL_R + 1e-9, `escaped the far wall ${k}`);
    }
  }
  assert.ok(PAD_HALF > 0 && PAD_R > 0);
});

test('a ball that lands wide is called wide even if a paddle touches it in the same tick', () => {
  const s = create('match', 3);
  s.live = true; s.lastHit = 1;
  Object.assign(s.ball, { x: 0.85, y: -1.165, vx: 0, vy: -11, curve: 0, bounceY: -1.17, bounced: false });
  const p = s.pads[0];
  p.x = p.px = 0.85; p.y = p.py = -1.25;
  const ev: Event[] = [];
  step(s, ev);
  assert.deepEqual(ev.map((e) => e.t), ['point']);
  assert.deepEqual(s.score, [1, 0]);
});

test('aimFor inverts landX, and only the paddle tip goes wide', () => {
  for (let x = -HALF_W; x <= HALF_W; x += 0.01) assert.ok(Math.abs(landX(aimFor(x)) - x) < 1e-9, `x ${x}`);
  // The share of the contact width that lands off the table.
  let wide = 0;
  for (let i = 0; i <= 1000; i++) if (Math.abs(landX(-1 + i / 500)) > HALF_W) wide++;
  assert.ok(wide / 1001 < 0.1, `${wide} of 1001 offsets go wide`);
});

test('a flicked serve is no faster than a gentle one by more than the serve cap', () => {
  const s = create('match', 4);
  s.pads[0].vy = 30; // a mouse flicked forward as fast as it goes
  serve(s);
  assert.ok(Math.hypot(s.ball.vx, s.ball.vy) <= 3.3 + 1.5 * 0.55 + 1e-9);
});
