// README images and the 1200x630 social card, from the built page.
// Usage: node scripts/media.ts [url]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const shot = async (w: number, h: number, dpr: number, touch: boolean, path: string, play: boolean) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  await page.goto(url + (play ? '?autoplay' : ''));
  await page.waitForTimeout(1200);
  if (play) { await page.click('.levels button[data-level="1"]'); await page.waitForTimeout(5200); }
  await page.screenshot({ path });
  await page.close();
};
await shot(390, 844, 2, true, 'docs/phone.png', true);
await shot(1440, 900, 1, false, 'docs/desktop.png', false);
await shot(1200, 630, 1, false, 'public/og.png', false);
await browser.close();
