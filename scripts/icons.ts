// Renders public/icon.svg to the PNG sizes the manifest and iOS want.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-180', 180, 0], ['icon-maskable', 512, 0.1]] as const) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<body style="margin:0;background:#0B1220;display:grid;place-items:center;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `).replace(pad ? 'rx="112"' : '__', 'rx="0"')}</body>`);
  await page.screenshot({ path: `public/${name}.png`, omitBackground: false });
}
await browser.close();
