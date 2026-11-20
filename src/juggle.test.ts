import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALL_R, BAT_R, create, flick, landing, moveBat, multiplier, release, step, type JEvent, type Juggle } from './juggle.ts';

// A steady hand: moves at most 4 m/s toward where the ball will come down, meets it a little
// on the far side of its travel and a little further out than it lands, so the tilt of the
// bat sends it back toward the middle. That's how a person keeps a ball over their hand.
function track(j: Juggle) {
  const l = landing(j), v = 4 / 240;
  const tx = l.x * 1.2 + j.ball.vx * 0.12, ty = l.y * 1.2 + j.ball.vy * 0.12;
  moveBat(j, j.bat.x + Math.max(-v, Math.min(v, tx - j.bat.x)), j.bat.y + Math.max(-v, Math.min(v, ty - j.bat.y)));
}

function play(j: Juggle, ticks: number, each?: (j: Juggle) => void) {
  const ev: JEvent[] = [];
  for (let i = 0; i < ticks && j.live; i++) { (each ?? track)(j); step(j, ev); }
  return ev;
}

test('a ball held over a still bat bounces at a steady height', () => {
  const j = create(3);
  release(j);
  let peak = 0, peaks: number[] = [];
  const ev: JEvent[] = [];
  for (let i = 0; i < 240 * 6; i++) {
    moveBat(j, j.ball.x, j.ball.y); // only to cancel the drift each bounce adds
    const before = j.ball.vz;
    step(j, ev);
    if (before > 0 && j.ball.vz <= 0) peaks.push(j.ball.z), peak = Math.max(peak, j.ball.z);
  }
  assert.ok(j.live, 'dropped it');
  peaks = peaks.slice(2);
  for (const p of peaks) assert.ok(Math.abs(p - peaks[0]) < 0.02, `peaks ${peaks.map((x) => x.toFixed(3))}`);
});

test('a steady hand keeps the ball up for hundreds of bounces as it speeds up', () => {
  const j = create(5);
  release(j);
  play(j, 240 * 300);
  assert.ok(j.live && j.bounces > 300, `${j.bounces} bounces`);
});

test('a bat that stays put while the ball drifts away drops it, and only once', () => {
  const j = create(7);
  release(j);
  const ev = play(j, 240 * 60, (jj) => moveBat(jj, 0, 0));
  assert.equal(j.live, false);
  assert.equal(ev.filter((e) => e.t === 'drop').length, 1);
});

test('the ball never passes through the bat, even on a fast fall', () => {
  for (let k = 0; k < 500; k++) {
    const j = create(k + 1);
    release(j);
    Object.assign(j.ball, { x: 0, y: 0, z: 0.05 + (k % 10) * 0.2, vz: -(1 + (k % 25)) }); // up to 25 m/s down
    const ev: JEvent[] = [];
    for (let i = 0; i < 240 && !ev.length; i++) { moveBat(j, 0, 0); step(j, ev); }
    assert.equal(ev[0]?.t, 'hit', `case ${k}`);
    assert.ok(j.ball.vz > 0 && j.ball.z >= BALL_R - 1e-6, `case ${k}: z ${j.ball.z}`);
  }
});

test('a flick timed to the contact sends the ball higher and scores double', () => {
  const peakAfter = (doFlick: boolean) => {
    const j = create(9);
    release(j);
    const ev: JEvent[] = [];
    let flicked = false;
    for (let i = 0; i < 240 * 3; i++) {
      moveBat(j, j.ball.x, j.ball.y);
      // Flick a few ticks before the ball reaches the bat, so it meets the bat on the way up.
      if (doFlick && !flicked && j.ball.vz < 0 && landing(j).t < 0.03) { flick(j); flicked = true; }
      step(j, ev);
      if (ev.length) break;
    }
    const hit = ev[0] as Extract<JEvent, { t: 'hit' }>;
    let peak = 0;
    for (let i = 0; i < 240 * 2 && j.ball.vz > -1; i++) { moveBat(j, j.ball.x, j.ball.y); step(j, []); peak = Math.max(peak, j.ball.z); }
    return { peak, hit };
  };
  const plain = peakAfter(false), high = peakAfter(true);
  assert.ok(high.hit.high && !plain.hit.high);
  assert.ok(high.peak > plain.peak * 1.6, `${high.peak} vs ${plain.peak}`);
  assert.equal(high.hit.gain, plain.hit.gain * 2);
});

test('the rim gives a dead bounce, breaks the streak and scores 1', () => {
  const j = create(11);
  release(j);
  j.streak = 7;
  moveBat(j, 0, 0); moveBat(j, 0, 0);
  Object.assign(j.ball, { x: BAT_R + 0.008, y: 0, z: 0.2, vx: 0, vy: 0, vz: -2 });
  const ev: JEvent[] = [];
  for (let i = 0; i < 240 && !ev.length; i++) { moveBat(j, 0, 0); step(j, ev); }
  const hit = ev[0] as Extract<JEvent, { t: 'hit' }>;
  assert.ok(hit.edge && hit.gain === 1 && j.streak === 0);
  assert.ok(j.ball.vx > 0.5, 'thrown outward');
});

test('the clean-streak multiplier steps up every five, to four', () => {
  assert.deepEqual([0, 4, 5, 9, 10, 15, 40].map(multiplier), [1, 1, 2, 2, 3, 4, 4]);
});

test('the same seed and the same hand give the same game', () => {
  const run = () => { const j = create(42); release(j); play(j, 240 * 20); return JSON.stringify(j); };
  assert.equal(run(), run());
});
