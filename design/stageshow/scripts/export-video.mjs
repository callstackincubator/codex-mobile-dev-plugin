#!/usr/bin/env node
// Export one pass of an example's loop as a 1920x1080 MP4.
//   node scripts/export-video.mjs <example> [--base http://127.0.0.1:5191] [--fps 60] [--out videos/<example>.mp4]
// Time runs on the kit's virtual clock, stepped one frame at a time, so every
// frame is exact regardless of machine load.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const name = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
const opt = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback }
if (!name) { console.error('usage: export-video.mjs <example> [--fps 60] [--out file.mp4]'); process.exit(1) }
const base = opt('--base', 'http://127.0.0.1:5191')
const fps = Number(opt('--fps', '60'))
const out = resolve(process.cwd(), opt('--out', `videos/${name}.mp4`))
const maxSeconds = Number(opt('--max', '30'))
const W = 1920, H = 1080

const clockSource = readFileSync(resolve(root, 'kit/clock.ts'), 'utf8')
const { code } = await transform(clockSource, { loader: 'ts', format: 'esm' })
const init = `(() => {${code.replace(/^export\s+/gm, '')}
  installVirtualClock({ fps: ${fps}, epoch: Date.UTC(2026, 9, 2, 15, 42) })
  window.__loops = 0
  addEventListener('stageshow:loop', () => { window.__loops++ }, true)
})()`

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const url = `${base}/?capture=${encodeURIComponent(name)}`

// The md-* scenes share a 960 x 540 wide design (examples/md-shared), so the
// viewport is that stage and the device scale makes it 1920 x 1080.
const cssW = 960, cssH = 540
const context = await browser.newContext({ viewport: { width: cssW, height: cssH }, deviceScaleFactor: W / cssW })
await context.addInitScript({ content: init })
const page = await context.newPage()
page.on('pageerror', e => console.error('page error:', e.message))
await page.goto(url)
await page.addStyleTag({ content: 'html, body { background: #fff !important; overflow: hidden; }' })
// In-page polling waits on timers the virtual clock holds, so poll from Node
// and step the clock between looks.
let size = null
for (let i = 0; !size; i++) {
  if (i > 600) throw new Error(`${name}: the stage never mounted`)
  size = await page.evaluate(() => {
    const r = document.querySelector('#example .ss-stage')?.getBoundingClientRect()
    return r && r.width > 0 ? { w: Math.round(r.width), h: Math.round(r.height) } : null
  })
  if (!size) await page.evaluate(() => window.__stageshow?.clock?.step(1))
}
if (size.w !== cssW || size.h !== cssH) throw new Error(`${name}: stage is ${size.w} x ${size.h}, expected ${cssW} x ${cssH}`)

const step = () => page.evaluate(() => window.__stageshow.clock.step(1))
const loops = () => page.evaluate(() => window.__loops)
// Run until the first pass begins.
for (let i = 0; (await loops()) < 1; i++) {
  if (i > fps * 10) throw new Error(`${name}: the loop never started`)
  await step()
}

mkdirSync(dirname(out), { recursive: true })
const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
  '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((ok, fail) => ffmpeg.on('close', c => c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`))))

let frames = 0
const limit = fps * maxSeconds
while (frames < limit) {
  const shot = await page.screenshot({ type: 'png', animations: 'allow', caret: 'initial' })
  if (!ffmpeg.stdin.write(shot)) await new Promise(r => ffmpeg.stdin.once('drain', r))
  frames++
  await step()
  if ((await loops()) >= 2) break
}
ffmpeg.stdin.end()
await done
await browser.close()
console.log(`${name}: ${frames} frames (${(frames / fps).toFixed(2)}s${frames >= limit ? ', hit --max' : ''}) -> ${out}`)
