// Renders og/og.html as the social card (public/og-image.jpg, 1200x630, always dark) and the
// optional dark README banner (--banner, 1660x512), and writes
// the icons (public/favicon.svg, favicon-32.png, apple-touch-icon.png) from the mark. Run `pnpm og` after changing
// src/site/content.ts, src/site/brand.ts, og/og.html or the signature scene.
//
// The card never repeats a fact: this script imports content.ts and brand.ts (Node strips
// their types) and serves them to the page as /og/site.json and /og/brand.css. The dither
// module is served the same way, as /og/dither.js.
//
// Uses Playwright Chromium. Set PLAYWRIGHT_CHANNEL=chrome to select local Google Chrome.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import sharp from 'sharp';

import { accent, brandCss } from '../src/site/brand.ts';
import { home, site } from '../src/site/content.ts';

const rootUrl = new URL('..', import.meta.url);
const root = fileURLToPath(rootUrl);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

// What the card shows, all from content.ts and brand.ts.
const card = {
  name: site.name,
  wordmark: site.wordmark,
  headline: site.headline,
  install: site.install,
  platforms: site.platforms,
  mark: site.mark ?? [],
  transcript: home.transcript,
};

// A static server over the website folder, plus the three generated files above.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (path === '/og/dither.js') {
      const sourcePath = join(root, 'src/components/site/dither.ts');
      const source = await readFile(sourcePath, 'utf8');
      res.writeHead(200, { 'Content-Type': types['.js'] });
      const javascript = stripTypeScriptTypes(source);
      res.end(javascript);
      return;
    }
    if (path === '/og/site.json') {
      res.writeHead(200, { 'Content-Type': types['.json'] });
      const json = JSON.stringify(card);
      res.end(json);
      return;
    }
    if (path === '/og/brand.css') {
      res.writeHead(200, { 'Content-Type': types['.css'] });
      res.end(brandCss);
      return;
    }
    const normalizedPath = normalize(path);
    const relativePath = normalizedPath.replace(/^(\.\.[/\\])+/, '');
    const file = join(root, relativePath);
    const body = await readFile(file);
    const extension = extname(file);
    res.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const listen = (resolve) => { server.listen(0, '127.0.0.1', resolve); };
await new Promise(listen);
const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

const publicPath = join(root, 'public');
await mkdir(publicPath, { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL;
const browser = await chromium.launch({ channel });
try {
  const shots = [
    { query: '', width: 1200, height: 630, scale: 1, path: 'public/og-image.jpg' },
  ];
  const includeBanner = process.argv.includes('--banner');
  if (includeBanner) {
    // 1245x384 at 4/3 gives the banner's 1660x512.
    shots.push(
      { query: '?format=banner', width: 1245, height: 384, scale: 4 / 3, path: 'public/banner.jpg' },
    );
  }
  for (const { query, width, height, scale, path } of shots) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    page.on('pageerror', (error) => console.error(error));
    await page.goto(`http://127.0.0.1:${port}/og/og.html${query}`);
    await page.waitForFunction(() => /** @type {any} */ (window).ogReady === true);
    const png = await page.screenshot({ type: 'png' });
    const image = sharp(png);
    image.jpeg({ quality: 90, mozjpeg: true });
    const jpeg = await image.toBuffer();
    const outputPath = join(root, path);
    await writeFile(outputPath, jpeg);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

// ---------- Icons ----------
// The mark in the accent, each step a whole number of pixels. Without a mark, the wordmark's
// first letter in dark on an accent block.
const BG = '#0a0a0a';
const mark = site.mark ?? [];
const rowLengths = mark.map((row) => row.length);
const markW = Math.max(0, ...rowLengths);
const markH = mark.length;

/** An SVG `size` px square: the mark centred on whole-pixel steps, `pad` px clear around it. */
function icon(size, pad, background) {
  const fill = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  if (!markH) {
    const uppercase = site.wordmark.toUpperCase();
    const letter = [...uppercase][0] ?? '';
    const box = size - pad * 2;
    const roundedSize = Math.round(box * 0.72 * 100);
    const fontSize = roundedSize / 100;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${fill}<rect x="${pad}" y="${pad}" width="${box}" height="${box}" fill="${accent}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="${BG}">${letter}</text></svg>`;
  }
  const markSide = Math.max(markW, markH);
  const availableStep = (size - pad * 2) / markSide;
  const wholeStep = Math.floor(availableStep);
  const step = Math.max(1, wholeStep);
  const x0 = Math.floor((size - step * markW) / 2);
  const y0 = Math.floor((size - step * markH) / 2);
  const pixels = [];
  for (let y = 0; y < markH; y++) {
    const row = mark[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') pixels.push(`<rect x="${x0 + x * step}" y="${y0 + y * step}" width="${step}" height="${step}"/>`);
    }
  }
  const rects = pixels.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">${fill}<g fill="${accent}">${rects}</g></svg>`;
}

// The SVG favicon scales, so any whole step size does; 10px steps keep the numbers readable.
const side = Math.max(markW, markH, 1) * 10;
const faviconPath = join(publicPath, 'favicon.svg');
const favicon = icon(side, 0, '');
await writeFile(faviconPath, favicon);
for (const [name, size, pad, background] of [
  ['favicon-32.png', 32, 0, ''],
  ['apple-touch-icon.png', 180, 36, BG],
]) {
  const svg = icon(size, pad, background);
  const source = Buffer.from(svg);
  const image = sharp(source);
  image.png();
  const png = await image.toBuffer();
  const outputPath = join(publicPath, name);
  await writeFile(outputPath, png);
}
console.log('Wrote social card and icons. Add --banner to include the README banner.');
