// Spike B — fold a precompiled Explore stylesheet into the single-HTML build.
//
// Replicates scripts/build.mjs's CSS pipeline WITHOUT touching repo files:
//   1. compile src/ui/theme.css with the repo's @tailwindcss/node + oxide
//      Scanner exactly as the plugin build does (the "plugin sheet");
//   2. build a stand-in `explore.css` — either
//      (a) --rozenite: compile @rozenite/ui/styles.css (installed in
//          spike/node_modules, tailwind 4.2.2) with the repo's compiler, and
//          concatenate a synthetic ~1-3 MB `.ts-*` BEM block + `.dark` tokens
//          to reach a realistic compiled size; or
//      (b) --synthetic: skip @rozenite and just synthesize the sheet.
//   3. assemble spike/css/out/app-spike.html the same way build.mjs does
//      (replace APP_STYLE / APP_SCRIPT markers), with an inline script that
//      toggles `.dark` on a CONTAINER div (not <html>).
//
// Verifies:
//   a) both sheets coexist (plugin sheet + explore sheet, no clobbering);
//   b) total HTML size delta;
//   c) dark-mode scoping: whether @rozenite/ui's compiled output keys `.dark`
//      selectors so a container-level .dark class activates dark tokens
//      (check the emitted `.dark` / `:where(.dark, .dark *)` selectors);
//   d) whether @tailwindcss/node can compile `@import '@rozenite/ui/styles.css'`
//      when the package is NOT present (expected: no — documents that the
//      future package must ship compiled CSS, which is the plan anyway).
//
// Run: node spike/css/build-spike.mjs [--rozenite] [--mb 2]
// Output: spike/css/out/{plugin.css,explore.css,app-spike.html,report.json}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..'); // the plugin repo root
const out = join(here, 'out');
await mkdir(out, { recursive: true });

const USE_ROZENITE = process.argv.includes('--rozenite');
const MB = Number(process.argv[(process.argv.indexOf('--mb') + 1)] ?? 2);

// Import the repo's own toolchain (devDependencies live at the repo root).
const { compile } = await import(join(repo, 'node_modules/@tailwindcss/node/dist/index.mjs'));
const { Scanner } = await import(join(repo, 'node_modules/@tailwindcss/oxide/index.js'));

const kb = n => `${(n / 1024).toFixed(0)} KB`;
const report = { node: process.version, useRozenite: USE_ROZENITE, targetMB: MB, checks: {} };

// ── 1. plugin sheet: exactly build.mjs's theme.css pipeline ────────────────
const themeSrc = await readFile(join(repo, 'src/ui/theme.css'), 'utf8');
const pluginCompiler = await compile(themeSrc, { base: join(repo, 'src/ui'), onDependency() {} });
const pluginScanner = new Scanner({ sources: [{ base: join(repo, 'src/ui'), pattern: '**/*.{ts,tsx}', negated: false }] });
const pluginCss = pluginCompiler.build(pluginScanner.scan());
report.pluginCssKB = Math.round(pluginCss.length / 1024);
await writeFile(join(out, 'plugin.css'), pluginCss);

// ── 2. explore sheet ───────────────────────────────────────────────────────
let rozeniteCompiledKB = 0;
let rozeniteDarkSelectors = null;
if (USE_ROZENITE) {
  const rozeniteBase = join(repo, 'spike/node_modules/@rozenite/ui');
  try {
    const src = await readFile(join(rozeniteBase, 'styles.css'), 'utf8');
    const compiler = await compile(src, { base: rozeniteBase, onDependency() {} });
    const scanner = new Scanner({ sources: [{ base: rozeniteBase, pattern: 'src/**/*.{ts,tsx}', negated: false }] });
    const css = compiler.build(scanner.scan());
    rozeniteCompiledKB = Math.round(css.length / 1024);
    // (c) how does the compiled dark variant look?
    rozeniteDarkSelectors = {
      bareDarkBlock: /\.dark\s*\{/.test(css),
      whereScoping: (css.match(/:where\(\.dark, \.dark \*\)/g) ?? []).length,
      htmlDark: /\.html\b|:root\.dark|html \.dark/.test(css),
      sample: (css.match(/[^{}]*\.dark[^{]*\{/) ?? []).slice(0, 5).map(s => s.trim().slice(0, 160)),
    };
    report.rozeniteCss = css; // kept for inspection; trimmed from report.json
    await writeFile(join(out, 'rozenite.compiled.css'), css);
  } catch (error) {
    report.rozeniteError = String(error.message).slice(0, 300);
    console.log('rozenite compile failed:', report.rozeniteError);
  }
}

// Synthetic precompiled component CSS: `.ts-*` BEM rules + a `.dark` token
// block, sized to approximate the future package's shipped explore.css.
function syntheticExploreCss(bytes) {
  const tokens = [
    ':root{--ts-bg:oklch(1 0 0);--ts-fg:oklch(.145 0 0);--ts-accent:oklch(.488 .243 264.376);--ts-border:oklch(.922 0 0);--ts-flame-0:#8ecae6;--ts-flame-1:#fb8500;}',
    '.dark{--ts-bg:oklch(.145 0 0);--ts-fg:oklch(.985 0 0);--ts-accent:oklch(.623 .214 259.815);--ts-border:oklch(.269 0 0);--ts-flame-0:#219ebc;--ts-flame-1:#ffb703;}',
  ].join('\n');
  const parts = [
    '/* stand-in precompiled Explore stylesheet (@rozenite/ui tokens + explore BEM) */',
    tokens,
  ];
  // Each rule ~ 190 bytes; content varies so size scales predictably.
  let i = 0;
  while (parts.reduce((a, p) => a + p.length, 0) < bytes) {
    const n = i % 64;
    parts.push(`.ts-flame__cell--${i}{background:var(--ts-flame-${n % 8});border-color:var(--ts-border);font-size:${9 + (i % 5)}px;grid-column:${n};padding:${(i % 7) / 4}px;border-radius:${i % 3}px;box-shadow:0 ${(i % 3)}px ${(i % 5)}px 0 oklch(0 0 0 / ${(i % 9) / 10});content:"rule-${i}";}`);
    if (i % 96 === 0) parts.push(`.dark .ts-flame__cell--${i}{background:color-mix(in oklab,var(--ts-flame-${n % 8}) 70%,black);}`);
    i++;
  }
  return { css: parts.join('\n'), rules: i };
}

const rozeniteCss = report.rozeniteCss ? report.rozeniteCss.replace(/@font-face\{[^}]*\}/g, '') : '';
delete report.rozeniteCss;
const explore = syntheticExploreCss(Math.max(0, MB * 1024 * 1024 - rozeniteCss.length));
const exploreCss = [rozeniteCss, explore.css].filter(Boolean).join('\n/* ---- explore BEM below ---- */\n');
report.exploreCssKB = Math.round(exploreCss.length / 1024);
report.exploreRules = explore.rules;
await writeFile(join(out, 'explore.css'), exploreCss);

// ── (d) can the plugin compile @rozenite/ui/styles.css WITHOUT the package? ─
try {
  const fake = await compile(`@import '@rozenite/ui/styles.css';`, { base: join(out), onDependency() {} });
  fake.build(new Scanner({ sources: [] }));
  report.checks.d_compilesWithoutPackage = 'UNEXPECTEDLY OK';
} catch (error) {
  report.checks.d_compilesWithoutPackage = `FAILS as expected: ${String(error.message).split('\n')[0].slice(0, 140)}`;
}

// ── 3. assemble the spike HTML exactly like build.mjs inlines styles ───────
const template = await readFile(join(repo, 'src/ui/index.html'), 'utf8');
const script = `
document.getElementById('toggle').addEventListener('click', () => {
  document.getElementById('explore-root').classList.toggle('dark');
});
// computed-style probe: what does the flame cell see in light vs dark?
window.probe = () => {
  const cell = document.querySelector('.ts-flame__cell--0');
  const root = document.getElementById('explore-root');
  const r = getComputedStyle(cell);
  return { containerDark: root.classList.contains('dark'), bg: r.backgroundColor, token: getComputedStyle(cell).getPropertyValue('--ts-bg').trim() };
};
`;
const html = template
  .replace('<!-- APP_STYLE -->', () => `<style>${pluginCss}</style>\n<style>${exploreCss}</style>`)
  .replace('<!-- APP_SCRIPT -->', () => `<div id="explore-root" class="p-4 text-foreground"><div class="ts-flame"><div class="ts-flame__cell--0 ts-flame__cell">cell</div></div><button id="toggle" class="rounded border border-border px-2 py-1">toggle dark</button></div><script>${script.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await writeFile(join(out, 'app-spike.html'), html);

report.htmlKB = Math.round(Buffer.byteLength(html) / 1024);
// baseline: plugin-only html (what the plugin ships today, CSS part only)
report.pluginOnlyHtmlKB = Math.round(Buffer.byteLength(template.replace('<!-- APP_STYLE -->', `<style>${pluginCss}</style>`)) / 1024);
report.deltaKB = report.htmlKB - report.pluginOnlyHtmlKB;

// (a) coexistence: plugin utilities + explore rules both present, plugin's
// data-theme dark variant untouched by the explore .dark block
report.checks.a_coexist = {
  pluginUtilities: /\.rounded\b/.test(pluginCss) && /\.text-foreground\b/.test(pluginCss),
  pluginThemeVariant: pluginCss.includes('[data-theme="dark"]'),
  exploreRulesInHtml: html.includes('.ts-flame__cell--0{') && html.includes('.dark{--ts-bg'),
  pluginTokensIntact: html.includes('--background: var(--color-background-primary'),
  twoStyleTags: (html.match(/<style>/g) ?? []).length === 2,
  // collision scan: identical selectors defined in BOTH sheets?
  selectorCollisions: (() => {
    const sel = css => new Set((css.match(/(^|\})\s*([^{}@\/]+?)\s*\{/g) ?? []).map(m => m.replace(/^[}\s]*|\s*\{$/g, '').trim()).filter(Boolean));
    const a = sel(pluginCss), both = [...sel(exploreCss)].filter(s => a.has(s));
    return { count: both.length, sample: both.slice(0, 8) };
  })(),
};
report.checks.c_darkScoping = rozeniteDarkSelectors ?? 'rozenite not compiled this run';

await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rozeniteCompiledKB, darkSelectors: rozeniteDarkSelectors }, null, 2));
