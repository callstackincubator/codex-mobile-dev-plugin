// @ts-check
// Expressive Code config lives in its own file so Markdown fences and the `<Code>` component
// render with the same dark palette: neutral greys, strings and numbers in the accent. The accent comes
// from src/site/brand.ts.
import { defineEcConfig, ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';

import { accent } from './src/site/brand.ts';

/**
 * @param {Record<'bg' | 'fg' | 'kw' | 'str' | 'fn' | 'num' | 'com' | 'punc' | 'type', string>} c
 */
function siteTheme(c) {
  const theme = {
    name: 'site-dark',
    type: 'dark',
    colors: {
      'editor.background': c.bg,
      'editor.foreground': c.fg,
    },
    tokenColors: [
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: c.com, fontStyle: 'italic' },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'keyword.operator.new',
          'keyword.control',
          'variable.language',
          'constant.language',
        ],
        settings: { foreground: c.kw },
      },
      {
        scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'],
        settings: { foreground: c.str },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call',
          'entity.name.tag',
        ],
        settings: { foreground: c.fn },
      },
      {
        scope: ['constant.numeric', 'constant.other', 'support.constant'],
        settings: { foreground: c.num },
      },
      {
        scope: [
          'entity.name.type',
          'support.type',
          'support.class',
          'entity.other.attribute-name',
          'support.type.property-name',
        ],
        settings: { foreground: c.type },
      },
      {
        scope: ['punctuation', 'meta.brace', 'keyword.operator'],
        settings: { foreground: c.punc },
      },
      {
        scope: ['variable', 'variable.other', 'meta.object-literal.key'],
        settings: { foreground: c.fg },
      },
    ],
  };
  const json = JSON.stringify(theme);
  return ExpressiveCodeTheme.fromJSONString(json);
}

const dark = siteTheme({
  bg: '#111111',
  fg: '#ededed',
  kw: '#a3a3a3',
  str: accent,
  fn: '#ffffff',
  num: accent,
  com: '#8a8a8a',
  punc: '#9e9e9e',
  type: '#ffffff',
});

export default defineEcConfig({
  themes: [dark],
  styleOverrides: {
    borderRadius: '0',
    borderWidth: '1px',
    borderColor: '#ffffff26',
    codeFontFamily: "'Geist Mono', ui-monospace, monospace",
    codeFontSize: '0.875rem',
    codeLineHeight: '1.7',
    uiFontFamily: "'Geist Mono', ui-monospace, monospace",
    frames: {
      shadowColor: 'transparent',
      frameBoxShadowCssValue: 'none',
      editorActiveTabIndicatorTopColor: accent,
      editorActiveTabIndicatorBottomColor: 'transparent',
      editorTabBarBackground: '#0a0a0a',
      editorActiveTabBackground: '#111111',
      terminalTitlebarBackground: '#0a0a0a',
      terminalBackground: '#111111',
      terminalTitlebarDotsOpacity: '0.35',
      terminalTitlebarBorderBottomColor: '#ffffff1a',
      tooltipSuccessBackground: accent,
      tooltipSuccessForeground: '#0a0a0a',
      inlineButtonBorder: '#ffffff40',
    },
  },
});
