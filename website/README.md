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

## GitHub Pages

Production is published at https://incubator.callstack.com/codex-mobile-dev-plugin/.
The organization owns `incubator.callstack.com`; this repository inherits that
host and uses its repository name as the path. Leave the repository's **Custom
domain** field empty and set **Settings → Pages → Source** to **GitHub Actions**.
The suggested Jekyll and Static HTML templates are unnecessary.

`.github/workflows/website.yml` checks and builds the independent `website/`
project with Node.js 24 and the pinned pnpm version. Pushes to `main` affecting
`website/**` or that workflow upload `website/dist` and deploy through the
`github-pages` environment. Pull requests run the same checks and build without
publishing. The workflow can also be run manually on `main`.

The build sets `SITE_URL=https://incubator.callstack.com` and
`SITE_BASE=/codex-mobile-dev-plugin`. Astro's base, navigation, Markdown links,
icons, social images, sitemap, and robots.txt share those values. Local dev and
Vercel builds use their own origin and an empty base. Pages remain `.html` files,
served at extensionless paths by GitHub Pages, matching Simlock's setup.

## Vercel

The Margelo team's `mobile-dev` project is connected through Vercel's GitHub
integration, with **Root Directory** set to `website`, **Include source files
outside of the Root Directory** disabled, Node.js 24, and
`ENABLE_EXPERIMENTAL_COREPACK=1`. Install/build/output settings are in
`vercel.json`. Branch pushes, including draft pull requests, receive previews.
Vercel also continues publishing Production deployments from `main`, alongside
GitHub Pages.

Vercel's **Ignored Build Step** skips builds when `website/` has not changed:

```sh
if [ -z "$VERCEL_GIT_PREVIOUS_SHA" ]; then exit 1; fi
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .
```

Exit code `0` skips and `1` builds; the command runs inside `website/`. Preview
builds use their deployment URL, retain Vercel Authentication, and are linked
from the pull request. Use Vercel's sharing controls for external reviewers.
`.vercelignore` excludes local QA reports and generated build output from CLI
uploads. No GitHub Actions deployment token is needed for Vercel previews.

## Content and design

- `site-brief.md`: accepted product facts and visual direction.
- `src/site/content.ts`: links, feature copy, environments, FAQ, and homepage metadata.
- `src/site/brand.ts`: the Signal blue accent and its derived dark palette.
- `src/content/docs/docs/`: user guides adapted from the repository documentation.
- `src/components/home/HeroDemo.astro` and `src/components/home/annotation/`: native HTML annotation and app-edit workflow, responsive layout, and Web Animations playback. The hero sits directly in the page without a window frame or surrounding fill.
- `src/components/site/FeaturePreview.astro` and `src/components/site/previews/`: native Storage and Performance animations shared by the homepage and docs, plus the phone and icons shared with the hero.
- `public/previews/LICENSE`: retained Stageshow source attribution.
- `src/components/site/dither.ts`: generated pixel scenes, rendered by one OffscreenCanvas worker implementation.

The website, docs, and README banner use a fixed dark palette. The site ignores system colour preferences and former saved theme choices; no theme controls are rendered.

The homepage's storage and performance sections and corresponding docs guides use the same native HTML/SVG animations in macOS windows, without an extra outer frame or video controls. They play when visible, pause offscreen or in a hidden tab, and show the completed state for reduced motion. Their source and choreography are documented in `src/components/site/previews/README.md`.

Website work does not change the plugin’s Sentry initialization or instrumentation, and the marketing site does not send remote telemetry.
