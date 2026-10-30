// @ts-check
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';

import { brandCss } from './src/site/brand.ts';
import { site as meta, noindexPaths } from './src/site/content.ts';
import { TITLE_DELIMITER } from './src/site/meta.ts';

const site = meta.url;
const repo = meta.repo;
const description = meta.description;
// Where this site lives inside the repo, for the docs' "Edit page" links.
const siteDir = 'website';

const sidebar = [
  { label: 'Introduction', slug: 'docs/introduction' },
  { label: 'Getting started', slug: 'docs/getting-started' },
  { label: 'Devices', slug: 'docs/devices' },
  { label: 'App control', slug: 'docs/app-control' },
  { label: 'Logs', slug: 'docs/logs' },
  { label: 'Performance', slug: 'docs/performance' },
  { label: 'Profiles', slug: 'docs/profiles' },
  { label: 'Storage', slug: 'docs/storage' },
  { label: 'Legal', items: [
    { label: 'Privacy', slug: 'docs/privacy' },
    { label: 'Terms', slug: 'docs/terms' },
  ] },
];

const sitemapIntegration = sitemap({
  filter: (page) => {
    const url = new URL(page);
    const path = url.pathname.replace(/\.html$/, '');
    return noindexPaths.includes(path) === false;
  },
});

const llmsPlugin = starlightLlmsTxt({ projectName: meta.name, description });
const docsIntegration = starlight({
  // Docs titles read "Page | Name", the pattern src/site/meta.ts builds for every page.
  title: meta.name,
  titleDelimiter: TITLE_DELIMITER,
  description,
  favicon: '/favicon.svg',
  // src/pages/404.astro replaces Starlight's 404, in the site's look.
  disable404Route: true,
  // Clean canonicals, per-page descriptions and breadcrumbs for docs pages.
  routeMiddleware: './src/routeData.ts',
  // The same tokens, fonts and lockup as the landing pages.
  customCss: ['./src/fonts/font-face.css', './src/styles/theme.css', './src/styles/docs.css'],
  components: {
    Head: './src/components/starlight/Head.astro',
    SiteTitle: './src/components/starlight/SiteTitle.astro',
    SocialIcons: './src/components/starlight/SocialIcons.astro',
    Footer: './src/components/starlight/Footer.astro',
    ThemeProvider: './src/components/starlight/DarkTheme.astro',
    ThemeSelect: './src/components/starlight/DarkTheme.astro',
  },
  social: [{ icon: 'github', label: 'GitHub', href: repo }],
  editLink: { baseUrl: `${repo}/edit/main/${siteDir}/src/content/docs/` },
  head: [
    // The accent as CSS variables (src/site/brand.ts), read by theme.css and docs.css.
    { tag: 'style', content: brandCss },
    // Starlight sets og:title, og:description and a large Twitter card, but no image.
    { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og-image.jpg` } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: meta.ogAlt } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: `${site}/og-image.jpg` } },
    { tag: 'meta', attrs: { name: 'twitter:image:alt', content: meta.ogAlt } },
    { tag: 'meta', attrs: { name: 'color-scheme', content: 'dark' } },
    {
      tag: 'meta',
      attrs: { name: 'theme-color', content: '#0a0a0a' },
    },
    {
      tag: 'link',
      attrs: { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
    },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
    {
      tag: 'link',
      attrs: { rel: 'alternate', type: 'text/plain', title: 'llms.txt', href: '/llms.txt' },
    },
  ],
  sidebar,
  plugins: [llmsPlugin],
});

export default defineConfig({
  site,
  // Pages are files (`docs/introduction.html`, `404.html`) served without `.html` or a trailing
  // slash (`cleanUrls` and `trailingSlash: false` in vercel.json).
  trailingSlash: 'never',
  build: { format: 'file' },
  // Responsive images: Markdown screenshots get a srcset, so phones don't download huge files.
  image: { layout: 'constrained' },
  devToolbar: { enabled: false },
  vite: {
    environments: {
      prerender: { resolve: { noExternal: ['cookie'] } },
    },
  },
  integrations: [sitemapIntegration, docsIntegration],
});
