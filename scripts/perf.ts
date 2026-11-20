// Load time and frame times at phone size with the CPU slowed 4x and a 4G-like network.
// Usage: node scripts/perf.ts [url]  (defaults to the live site)
import { chromium } from 'playwright';
const url = new URL(process.argv[2] ?? 'https://rally.ashwinsathian.com/');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
url.searchParams.set('autoplay', '');
await page.goto(url.href, { waitUntil: 'load' });
await page.waitForTimeout(500);
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint') ?? performance.getEntriesByType('paint')[0];
  return { ttfb: n.responseStart, fcp: fcp?.startTime, load: n.loadEventEnd, bytes: n.transferSize };
});
console.log(`first visit, 4G + 4x CPU: TTFB ${nav.ttfb.toFixed(0)} ms, FCP ${nav.fcp?.toFixed(0)} ms, load ${nav.load.toFixed(0)} ms, ${nav.bytes} bytes`);
await page.click('.levels button[data-level="1"]');
// Frame intervals over 6 s of a rally, measured in the page.
const gaps = await page.evaluate(() => new Promise<number[]>((res) => {
  const out: number[] = []; let last = performance.now(); const end = last + 6000;
  const f = (t: number) => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(out); };
  requestAnimationFrame(f);
}));
gaps.sort((a, b) => a - b);
const p = (q: number) => gaps[Math.floor(gaps.length * q)].toFixed(1);
console.log(`frames with 4x CPU slowdown: ${gaps.length} in 6 s, median ${p(0.5)} ms, p95 ${p(0.95)} ms, worst ${gaps.at(-1)!.toFixed(1)} ms`);
await browser.close();
