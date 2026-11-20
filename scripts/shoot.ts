// Screenshots of home, a match and solo at phone, landscape phone, tablet and desktop sizes,
// plus any console errors. Usage: node scripts/shoot.ts [url] [outdir]. ONLY=phone,desktop.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'docs/shots';
const sizes: [string, number, number, number, boolean][] = [
  ['phone', 390, 844, 3, true], ['phone-land', 844, 390, 3, true], ['tablet', 820, 1180, 2, true], ['desktop', 1440, 900, 1, false],
];
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch();
for (const [name, w, h, dpr, touch] of sizes) {
  if (only && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.stack)));
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-home.png` });
  for (const m of ['match', 'solo']) {
    await page.click(m === "match" ? ".levels button[data-level=\"1\"]" : "#go-solo");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-${m}-ready.png` });
    await page.keyboard.press('Space');
    await page.waitForTimeout(m === 'match' ? 700 : 450);
    await page.screenshot({ path: `${out}/${name}-${m}-play.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-${m}-paused.png` });
    await page.click('#paused [data-act=menu]');
    await page.waitForTimeout(300);
  }
  console.log(name, errs.length ? errs.slice(0, 5).join('\n  ') : 'no errors');
  await ctx.close();
}
await browser.close();
