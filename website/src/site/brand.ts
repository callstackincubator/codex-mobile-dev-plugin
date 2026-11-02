// Signal blue and its derived tokens, shared by landing pages, docs, code, dither scenes,
// social images, and icons. No other file may hard-code an accent hex.
//
// Accents already taken in the Callstack product family, do not reuse:
//   Apex          lime          #c6f432
//   Simlock       orange        #ff7a1a
//   Appduct       cyan          #3ddcff
//   agent-device  violet        #a47bff (family colour #8232ff)
//   Rozenite      crimson-rose  #ff4f7b
//
/** Brand, primary actions, the second beat of headlines, strings in code. */
export const accent = '#6f9dff';
/** Hover on accent fills: the accent mixed about halfway to white. */
export const accentHover = '#abc6ff';
// ---------- Derived values: nothing below needs editing ----------

const BG = '#0a0a0a';

/** `#rrggbb` as [r, g, b]. */
export function rgbOf(hex: string): [number, number, number] {
  const digits = hex.replace('#', '');
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` mixed toward `b` by `t` (0..1), as `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const channels = x.map((c, i) => {
    const channel = c + (y[i]! - c) * t;
    const rounded = Math.round(channel);
    const hex = rounded.toString(16);
    return hex.padStart(2, '0');
  });
  const hex = channels.join('');
  return `#${hex}`;
}

/** The accent as `r g b`, for `rgb(var(--accent-rgb) / 0.5)` and the dither palette. */
const accentChannels = rgbOf(accent);
export const accentRgb = accentChannels.join(' ');

/**
 * The accent as CSS variables on :root. Injected into every page's <head>: by Site.astro on the
 * landing pages and by the Starlight `head` config on the docs, so both read the same values.
 */
const accentLow = mix(BG, accent, 0.2);
const tokens = {
  '--accent': accent,
  '--accent-hover': accentHover,
  '--accent-rgb': accentRgb,
  '--accent-low': accentLow,
};
const entries = Object.entries(tokens);
const declarations = entries.map(([key, value]) => `${key}:${value}`);
const css = declarations.join(';');
export const brandCss = `:root{${css}}`;
