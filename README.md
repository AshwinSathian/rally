<p align="center">
  <img src="public/icon.svg" alt="" width="96" height="96">
</p>

<h1 align="center">Rally</h1>

<p align="center">
  Table tennis in the browser: bounce the ball on your bat for as long as you can, or play a match to eleven against a computer opponent that reads the ball the way a person does.
</p>

<p align="center">
  <a href="https://github.com/AshwinSathian/rally/actions/workflows/ci.yml"><img src="https://github.com/AshwinSathian/rally/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg" alt="No runtime dependencies">
  <img src="https://img.shields.io/badge/page-15%20KB%20gzipped-informational.svg" alt="15 KB gzipped">
</p>

<p align="center">
  <a href="https://rally.ashwinsathian.com"><b>Play it at rally.ashwinsathian.com</b></a>
</p>

<p align="center">
  <img src="docs/phone.png" alt="A match on a phone: the table seen from behind your paddle, the score at the top" width="260">
  &nbsp;
  <img src="docs/desktop.png" alt="The menu on a desktop, with two computer players rallying on the table beside it" width="600">
</p>

## Modes

**Match.** First to 11, win by two. Service changes every two points, and every point from 10–10. The opponent comes in three levels, Casual, Club and Pro, and your record against each is kept on the device. A shot that lands off the side of the table loses the point; so does a ball you can't reach.

**Solo.** You hold the bat flat in front of you and bounce the ball on it, seen from just above your hand, until you miss and it falls to the floor. The ball's shadow on the rubber sits straight below it; the camera drifts a little after your hand, as your eyes would. Every bounce scores. Hits inside the small ring in the middle of the rubber are clean, and every five clean hits in a row raise the multiplier, up to ×4. Press (tap, click or Space) as the ball lands to flick your wrist: the ball goes high and the bounce scores double, and a press up to 60 ms late still counts. Hit the wooden rim and the ball dies off it sideways. The bounces come quicker and the ball drifts a little more with each one.

The last two seconds of a game play back in slow motion before the result.

## Controls

| | Touch | Mouse | Keyboard |
|---|---|---|---|
| Move the paddle | Drag anywhere | Move | Arrow keys or WASD |
| Serve | Tap | Click | Space or Enter |
| Pause | Pause button | Pause button | Escape or P |

Touch moves the paddle by however far your finger moves, so your finger can rest anywhere and never covers the paddle. The mouse puts the paddle where the pointer is.

**Aiming.** Where the ball meets your paddle decides where it lands across the table. The mapping is gentle in the middle and steep at the ends, so a centred hit is safe, the corners take a hit near the tip, and only the rounded tip itself (about 7% of the paddle) sends the ball off the side. Pushing forward as you hit adds pace. Moving sideways as you hit adds spin, and the ball curves.

**Serving.** Your serve lands on the side of the table you serve from, and a sideways flick pushes it wider. Pushing forward adds a little pace, up to a cap, so a flicked mouse can't produce an unreturnable serve.

## How it's built

TypeScript and Vite with no runtime dependencies. The build inlines everything into one HTML file of about 15 KB gzipped; there are no fonts, images or audio files to fetch. Sounds are synthesised with Web Audio.

**Physics** (`src/sim.ts`) runs at a fixed 240 Hz in metres and seconds on a regulation 2.74 × 1.525 m table. It is pure and deterministic: no DOM, no clock, no `Math.random`.

The paddle's hitting edge is a capsule, and collision is solved as a sweep. Over one tick both the ball and the paddle move in straight lines, so subtracting the paddle's motion leaves one moving point against a still capsule, and the first contact time comes from a line–rectangle test and two line–circle tests. That is exact at any speed: a tick can't step over the paddle. `src/sim.test.ts` checks it against a brute-force walk of 20,000 sub-steps on 4,000 random cases, and against 20,000 random ticks with balls up to 40 m/s and paddles up to 60 m/s. The game caps the ball at 11 m/s.

Only the paddle the ball is heading for can hit it, so a ball can't be struck twice on its way out.

**Solo's physics** (`src/juggle.ts`) is a separate model with real gravity. The bat's face is a disc; contact is found the same way, as the moment the gap between the ball's underside and the moving face closes within a tick, so a falling ball can't pass through it at any speed (tested up to 25 m/s). A bounce keeps the ball at a steady height unless you flick. Three things set where it goes next: it keeps some of its sideways speed, a moving bat drags it along, and the face pushes it outward in proportion to how far from the centre it landed. That last one is the skill: the ball drifts a little more with every bounce, and you bring it back toward the middle of your reach by meeting it slightly on its outer side.

The drift and the push were tuned against a model of a hand that moves at most 1.2–4 m/s, misjudges the landing spot by 1.5–5 cm, and meets the ball 20% further out than it lands. Median bounces before a drop, 40 games each: 9 for the slowest and least accurate hand, 67 for a middle one, 349 for a good one, and a perfect hand never drops it. As with the match bots, the hand model's numbers are estimates.

The ball's height is drawn from an arc fitted to each shot and never decides a point. Where a shot lands is fixed at the moment of the hit, which keeps the rules in two dimensions and the look in three.

**The opponent** (`src/ai.ts`) predicts where the ball will cross its hitting line by stepping the same physics forward, spin included; a test checks the prediction against the simulation to 1e-9 m. Three things keep it from playing perfectly:

- It waits a reaction time (0.15–0.28 s by level) before it moves for a new shot.
- Its estimate is off by a fixed number of standard deviations per shot, scaled by the flight time left, so its guess converges as the ball comes in instead of jittering. Curving balls are misread more.
- Its paddle has a top speed and acceleration, and it brakes to stop on its target.

It aims away from you, as close to the side as its level dares, by choosing where on its paddle to meet the ball, and it aims nearer the middle when a fast ball leaves it short of time. A misread therefore moves the contact point and sends its shot somewhere else, sometimes off the table. Its errors come out of the same shot model as yours; there is no roll of the dice that decides it should miss.

Bots against bots, 100 matches per pairing (`npm run bench`):

| Row against column | Casual | Club | Pro |
|---|---|---|---|
| **Casual** | 47% (9.1–9.6) | 0% (1.6–11) | 0% (0.4–11) |
| **Club** | 100% (11–1.3) | 44% (9.3–10.0) | 0% (0.3–11) |
| **Pro** | 100% (11–0.3) | 100% (11–0.4) | 55% (9.4–9.5) |

Each cell is the row bot's win rate and the average score. Bots at different levels sit far apart because each makes the same kind of error on every shot.

**Tuning against people.** The levels were tuned against a model of a human player rather than against the bots: a 0.20–0.30 s reaction, a per-shot misjudgement of where the ball will be and of where on the paddle it will meet, curve only partly read, and a hand that follows the eye 50–100 ms late at 60 Hz but with no speed limit, which is what a mouse gives you. Win rates over 20 matches per cell, for that model at three skill settings:

| Modelled player | Casual | Club | Pro |
|---|---|---|---|
| First-timer | 50% | 0% | 0% |
| Average | 100% | 40% | 0% |
| Good | 100% | 100% | 40% |

The human model's parameters are estimates, not measurements, and each cell can be off by about ten points. One weakness is known: a good player who blocks every ball back to the middle beats Pro, because the bot loses the very long rallies that follow. No parameter change fixed it without making Pro unbeatable for everyone else.

**Input.** Pointer events carry their own timestamps, and `getCoalescedEvents()` returns the samples the browser merged between frames. Each 240 Hz tick moves your paddle to where your finger was at that tick's time, interpolated between samples, so the speed and direction of a swing don't depend on the display's frame rate. Chromium's `pointerrawupdate` is used where it exists, and the canvas asks for a `desynchronized` context to cut a frame of latency where the browser allows.

**Drawing** is Canvas 2D through a pinhole camera in both modes. In Solo (`src/hand.ts`) it sits above and behind your hand and pans after it. The pointer is mapped onto the bat's plane through the unpanned camera, so the pan never feeds back into where the bat goes. Matches (`src/view.ts`) look from behind your end of the table. The camera is fitted to the screen on every resize: high and steep on a tall phone, where the far half needs the room, and low on a wide screen. The same camera inverted maps a pointer onto the paddle's plane. The floor, table and net never move, so they are painted into offscreen canvases (the net into one only as big as the net) and painted again only when the screen size changes; each frame draws those images and the moving pieces, sorted far to near with the net slotted in between. Frames are interpolated between ticks.

**Speed.** On a phone viewport with the CPU slowed 4× and 150 ms of network latency, first paint is at about 320 ms, and a rally runs at 60 frames a second with no frame over 17 ms (`scripts/perf.ts`).

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # physics, rules and opponent tests
npm run bench      # bot-against-bot results by level
npm run build      # dist/index.html
```

`scripts/flow.ts` plays a full match and a Solo game in a real browser with `?autoplay` (a bot holds your paddle) and checks the pause dialog, the replay, the result and the saved record. `scripts/shoot.ts` takes screenshots at phone, tablet and desktop sizes. Both use Playwright.

It deploys as static files to Cloudflare Workers with `npm run deploy`.

## License

MIT
