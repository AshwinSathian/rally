// Plays a whole match in a real browser with ?autoplay (a bot holds your paddle), checks the
// pause dialog, the slow replay, the result and the saved record, then plays Solo to the end.
// Usage: node scripts/flow.ts [url]
import { chromium } from 'playwright';
const url = new URL(process.argv[2] ?? 'http://localhost:4173/');
url.searchParams.set('autoplay', '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e.stack)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const ok = (name: string, cond: boolean) => { console.log(cond ? 'ok  ' : 'FAIL', name); if (!cond) process.exitCode = 1; };
const st = () => page.evaluate(() => (window as any).__rally());

// Damaged storage must not stop the game from starting.
await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rally:v1', '{"record":null,"level":9,"best":"lots","sound":"no"}'); } });
await page.goto(url.href);
await page.waitForTimeout(800);
ok('boots with damaged storage', (await st()).screen === 'home' && errs.length === 0);
await page.click('.levels button[data-level="0"]');
await page.waitForTimeout(300);
ok('match starts', (await st()).screen === 'play');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('Escape pauses', await page.locator('#paused[open]').count() === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('Escape resumes', (await st()).screen === 'play');

const t0 = Date.now();
let sawReplay = false, pressedInReplay = false, longestAtReplay = -1;
while (Date.now() - t0 < 240_000) {
  const s = await st();
  if (s.replay && !pressedInReplay) {
    sawReplay = true; pressedInReplay = true; longestAtReplay = s.stats.longest;
    // An impatient Space during the replay must not serve a new ball.
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    ok('Space during the replay does nothing', !(await st()).s.live && (await st()).stats.longest === longestAtReplay);
  }
  if (s.screen === 'over') break;
  await page.waitForTimeout(100);
}
const s = await st();
ok(`match ends (${s.s.score.join('-')} in ${Math.round((Date.now() - t0) / 1000)} s)`, s.screen === 'over');
ok('slow replay before the result', sawReplay);
ok('result dialog', await page.locator('#over[open]').count() === 1);
console.log('    ', await page.locator('#over-h').textContent(), '|', (await page.locator('#over-stats').textContent())?.replace(/\s+/g, ' '));
const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('rally:v2') ?? '{}'));
ok('record saved', saved.record?.[0]?.[0] + saved.record?.[0]?.[1] === 1);
const recordAfterOne = JSON.stringify(saved.record);
await page.screenshot({ path: 'docs/shots/flow-over.png' });

await page.click('#over [data-act=menu]');
await page.waitForTimeout(300);
ok('back to menu', (await st()).screen === 'home');
ok('record shown on menu', ((await page.locator('#rec0').textContent()) ?? '').includes('–'));

// Leaving for the menu during the pause after the winning point must not record anything.
await page.click('.levels button[data-level="0"]');
await page.evaluate(() => { (window as any).__rally().s.score[0] = 10; });
while ((await st()).between <= 0) await page.waitForTimeout(50);
const sc = (await st()).s.score;
if (sc[0] === 11) {
  await page.keyboard.press('Escape');
  await page.click('#paused [data-act=menu]');
  await page.waitForTimeout(6000);
  ok('menu after match point records nothing', await page.locator('#over[open]').count() === 0 && JSON.stringify(JSON.parse(await page.evaluate(() => localStorage.getItem('rally:v2') ?? '{}')).record) === recordAfterOne);
} else console.log('     (point went to the bot; skipped the match-point menu check)');
await page.keyboard.press('Escape').catch(() => {});
if ((await st()).screen !== 'home') { await page.click('#paused [data-act=menu]').catch(() => {}); }
// A Casual bot holds the paddle for Solo, so the game ends inside a couple of minutes.
url.searchParams.set('autoplay', '0');
await page.goto(url.href);
await page.waitForTimeout(500);
await page.click('#go-solo');
const t1 = Date.now();
while (Date.now() - t1 < 120_000 && (await st()).screen !== 'over') await page.waitForTimeout(250);
ok('solo ends', (await st()).screen === 'over');
console.log('    ', await page.locator('#over-h').textContent(), '|', (await page.locator('#over-stats').textContent())?.replace(/\s+/g, ' '));
await page.screenshot({ path: 'docs/shots/flow-solo-over.png' });
ok('no errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await browser.close();
