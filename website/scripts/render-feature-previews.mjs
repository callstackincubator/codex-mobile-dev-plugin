// Re-renders the branch's authored scenes with the plugin's actual dark tokens.
// Usage: node scripts/render-feature-previews.mjs <stageshow-directory> [--only storage] [--stills|--serve]
// Adapted from Stageshow's MIT-licensed exporter; see public/previews/LICENSE.
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright-core';
import sharp from 'sharp';

import { HOSTS } from '../../tooling/hosts/profiles.ts';

const sourceArgument = process.argv[2];
if (sourceArgument === undefined) {
  throw new Error('Pass the Stageshow directory from feat/feature-previews.');
}
const sourcePath = resolve(sourceArgument);
const source = await realpath(sourcePath);
const stillsOnly = process.argv.includes('--stills');
const onlyFlag = process.argv.indexOf('--only');
const onlyAsset = onlyFlag >= 0 ? process.argv[onlyFlag + 1] : undefined;
const websiteUrl = new URL('..', import.meta.url);
const website = fileURLToPath(websiteUrl);
const repository = resolve(website, '..');
const output = join(website, 'public/previews');
const reviewPrefix = join(tmpdir(), 'mobile-dev-dark-previews-');
const review = await mkdtemp(reviewPrefix);
const fps = 60;
const context = HOSTS.codex.context('dark', 'inline');
const hostTokens = context.styles.variables;
const tokenEntries = Object.entries(hostTokens);
const declarations = tokenEntries.map(([name, value]) => `${name}: ${value};`);
const themePath = join(repository, 'packages/ui/src/theme.css');
const theme = await readFile(themePath, 'utf8');
const darkBlock = theme.match(/html\[data-theme="dark"\] \{([\s\S]*?)\n\}/);
const dark = darkBlock[1];
const tailwindPath = join(repository, 'node_modules/tailwindcss/theme.css');
const tailwind = await readFile(tailwindPath, 'utf8');
const semantic = tailwind.match(/--color-(?:emerald|rose|violet|blue|amber)-(?:300|400|500):[^;]+;/g);
const landingPath = join(website, 'src/styles/landing.css');
const landing = await readFile(landingPath, 'utf8');
const groundProperty = landing.match(/--bg:\s*([^;]+);/);
const ground = groundProperty[1];
const stylesheetPath = join(website, 'previews/plugin-dark.css');
const stylesheet = await readFile(stylesheetPath, 'utf8');
const colors = declarations.join('\n');
const semanticColors = semantic.join('\n');
const css = `:root { ${colors} ${semanticColors} --preview-ground: ${ground}; }
html[data-theme="dark"] { ${dark} }
${stylesheet}`;
const clockPath = join(source, 'kit/clock.ts');
const clockSource = await readFile(clockPath, 'utf8');
const clockJavascript = stripTypeScriptTypes(clockSource);
const clockBody = clockJavascript.replace(/^export\s+/gm, '');
const init = `(() => {
  ${clockBody}
  window.__stageshow = { theme: 'dark' };
  installVirtualClock({ fps: ${fps}, epoch: Date.UTC(2026, 9, 2, 15, 42) });
  window.__loops = 0;
  addEventListener('stageshow:loop', () => { window.__loops += 1; }, true);
  document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = 'dark'; }, { once: true });
})()`;

const vitePath = join(source, 'node_modules/vite/dist/node/index.js');
const viteUrl = pathToFileURL(vitePath);
const { createServer } = await import(viteUrl.href);
const server = await createServer({
  root: join(source, 'playground'),
  configFile: join(source, 'playground/vite.config.ts'),
  server: { port: 0, host: '127.0.0.1', fs: { allow: [source] } },
  plugins: [{
    name: 'mobile-dev-dark-previews',
    transformIndexHtml(html) {
      const themed = html.replace('<html lang="en">', '<html lang="en" data-theme="dark">');
      return {
        html: themed,
        tags: [
          { tag: 'style', children: css, injectTo: 'head' },
          { tag: 'script', children: "window.__stageshow = { ...window.__stageshow, theme: 'dark' };", injectTo: 'head' },
        ],
      };
    },
  }],
});
await server.listen();
const { port } = server.httpServer.address();
const baseUrl = `http://127.0.0.1:${port}`;
if (process.argv.includes('--serve')) {
  console.log(`Dark preview server: ${baseUrl}`);
  await new Promise(() => {});
}
const browser = await chromium.launch({ channel: 'chrome' });
console.log(`Review frames: ${review}`);
await mkdir(output, { recursive: true });

const scenes = [
  { name: 'md-recording', asset: 'performance', poster: 9, surface: '.mr-card', width: 960, height: 540 },
  { name: 'md-storage', asset: 'storage', poster: 7, surface: '.mst-body', width: 960, height: 540 },
];
const selectedScenes = scenes.filter(scene => onlyFlag < 0 || scene.asset === onlyAsset);
try {
  if (selectedScenes.length === 0) throw new Error(`Unknown preview: ${onlyAsset}`);
  for (const scene of selectedScenes) {
    const viewport = { width: scene.width, height: scene.height };
    const capture = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await capture.addInitScript({ content: init });
    const page = await capture.newPage();
    let pageError;
    page.on('pageerror', error => { pageError = error; });
    await page.goto(`${baseUrl}/?capture=${scene.name}`);
    const stage = page.locator('.ss-stage');
    for (let frame = 0; ; frame += 1) {
      if (pageError) throw pageError;
      const mounted = await stage.count();
      const loops = await page.evaluate(() => window.__loops);
      if (mounted > 0 && loops > 0) break;
      if (frame > fps * 10) throw new Error(`${scene.name} did not start.`);
      await page.evaluate(() => window.__stageshow.clock.step(1));
    }

    const surfaces = page.locator(scene.surface);
    const surface = surfaces.first();
    const palette = await surface.evaluate(element => {
      const styles = getComputedStyle(element);
      return { background: styles.backgroundColor, foreground: styles.color };
    });
    const paletteJson = JSON.stringify(palette);
    console.log(`${scene.name}: ${paletteJson}`);
    const reviewFrames = new Set([0, 210, 420, 540, 660, 780]);
    let encoder;
    let encoded;
    const destination = join(review, `${scene.asset}.mp4`);
    const posterPath = join(review, `${scene.asset}.webp`);
    if (stillsOnly === false) {
      encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
        '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', destination],
      { stdio: ['pipe', 'inherit', 'inherit'] });
      encoded = once(encoder, 'close');
    }

    let frames = 0;
    while (frames < fps * 25) {
      if (pageError) throw pageError;
      const savePoster = frames === scene.poster * fps;
      if (stillsOnly === false || reviewFrames.has(frames) || savePoster) {
        const shot = await page.screenshot({ type: 'png', animations: 'allow', caret: 'initial' });
        if (reviewFrames.has(frames)) {
          const framePath = join(review, `${scene.asset}-${frames}.png`);
          await writeFile(framePath, shot);
        }
        if (savePoster && stillsOnly === false) {
          const poster = sharp(shot);
          const webp = poster.webp({ quality: 85 });
          await webp.toFile(posterPath);
        }
        if (encoder && encoder.stdin.write(shot) === false) await once(encoder.stdin, 'drain');
      }
      frames += 1;
      await page.evaluate(() => window.__stageshow.clock.step(1));
      const loops = await page.evaluate(() => window.__loops);
      if (loops >= 2) break;
      if (frames % 120 === 0) console.log(`${scene.name}: ${frames} frames`);
    }
    if (encoder) {
      encoder.stdin.end();
      const [code] = await encoded;
      if (code !== 0) throw new Error(`FFmpeg exited with ${code}.`);
      const publishedVideo = join(output, `${scene.asset}.mp4`);
      const publishedPoster = join(output, `${scene.asset}.webp`);
      await rename(destination, publishedVideo);
      await rename(posterPath, publishedPoster);
    }
    console.log(`${scene.name}: ${frames} frames, ${frames / fps}s`);
    await capture.close();
  }
} finally {
  await browser.close();
  await server.close();
}
