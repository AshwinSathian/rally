// Bot against bot at every pairing: who wins, by how much, and how long rallies last.
// Usage: node scripts/bench.ts [matches per pairing]
import { create, nextPoint, step, winner, type Event } from '../src/sim.ts';
import { Bot, LEVELS } from '../src/ai.ts';
const N = Number(process.argv[2] ?? 100);
for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
  let wins = 0, shots = 0, rallies = 0, wide = 0, missed = 0, pts = [0, 0];
  for (let i = 0; i < N; i++) {
    const s = create('match', i + 1);
    const bots = [new Bot(0, LEVELS[a], i * 3 + 1), new Bot(1, LEVELS[b], i * 7 + 2)];
    const ev: Event[] = [];
    while (winner(s.score) < 0) {
      bots[0].tick(s); bots[1].tick(s); ev.length = 0; step(s, ev);
      for (const e of ev) {
        if (e.t === 'hit') shots++;
        if (e.t === 'point') { rallies++; if (e.why === 'wide') wide++; else missed++; nextPoint(s, 0); }
      }
    }
    if (winner(s.score) === 0) wins++;
    pts[0] += s.score[0]; pts[1] += s.score[1];
  }
  console.log(`${LEVELS[a].name.padEnd(6)} v ${LEVELS[b].name.padEnd(6)} wins ${(wins / N * 100).toFixed(0).padStart(3)}%  avg ${(pts[0] / N).toFixed(1)}-${(pts[1] / N).toFixed(1)}  shots/rally ${(shots / rallies).toFixed(1)}  wide ${(wide / rallies * 100).toFixed(0)}%`);
}
