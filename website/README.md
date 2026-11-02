# Mobile Dev website

Astro and Starlight, using [Callstack’s product web design skill](https://github.com/callstackincubator/product-web-design). This is an independent website project inside the Mobile Dev repository; plugin packages keep the root npm workspace.

## Local development

Use Node.js 24, then run from the repository root:

```sh
pnpm --dir website install --ignore-workspace
pnpm --dir website dev
```

The site opens at http://localhost:4321. The homepage is `/`, user guides start at `/docs/introduction`, and `/404` previews the custom not-found page.

```sh
pnpm --dir website check
pnpm --dir website og
pnpm --dir website build
pnpm --dir website preview
```

The social-card script needs Playwright Chromium (`pnpm --dir website exec playwright-core install chromium`). To select an installed Google Chrome instead, run `PLAYWRIGHT_CHANNEL=chrome pnpm --dir website og`. Generated social cards and icons are committed under `public/`, so deployment does not require a browser. Add `--banner` to the `og` command when creating the optional README banner.

## Vercel

For a Git-connected project, choose this repository and set **Root Directory** to `website`, **Node.js** to 24, install command to `pnpm install --frozen-lockfile`, build command to `pnpm build`, and output directory to `dist` (also declared in `vercel.json`). Add the project environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` to use the pinned pnpm version. Vercel builds use their generated deployment URL. Set `SITE_URL` to the chosen production origin when publishing on a custom domain so canonical URLs, social metadata, robots, and sitemaps use that origin. Local builds use `http://localhost:4321`.

Initial hosting uses the **Margelo** team’s `mobile-dev` project temporarily, at https://mobile-dev-snowy.vercel.app. CLI deployments run from `website/` with the project root set to `.`. If connecting the full Git repository, change the Vercel Root Directory to `website` first.

The production environment pins `SITE_URL` to that temporary public origin. Preview builds use their generated deployment URL. `.vercelignore` excludes local QA reports, screenshots, and generated Astro/build output from CLI uploads.

The final production domain is undecided. Transfer the project to its eventual owner later, attach that domain, and update `SITE_URL` and the root README’s website/banner URLs. Then verify the sitemap and register the final origin in Search Console. Configure a redirect from the unused www or apex hostname to the chosen canonical hostname when attaching DNS.

## Content and design

- `site-brief.md`: accepted product facts and visual direction.
- `src/site/content.ts`: links, feature copy, environments, FAQ, and homepage metadata.
- `src/site/brand.ts`: the Signal blue accent and its derived dark palette.
- `src/content/docs/docs/`: user guides adapted from the repository documentation.
- `src/components/home/HeroDemo.astro`: illustrated coding workflow; this does not imply an issue-tracker integration.
- `src/components/site/dither.ts`: generated pixel scenes, rendered by one OffscreenCanvas worker implementation.

The website, docs, and README banner use a fixed dark palette. The site ignores system colour preferences and former saved theme choices; no theme controls are rendered.

Performance and storage diagrams use fixed demonstration data. Website work does not change the plugin’s Sentry initialization or instrumentation, and the marketing site does not send remote telemetry.
