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

Initial hosting uses the **Margelo** team’s `mobile-dev` project temporarily, at https://mobile-dev-snowy.vercel.app. It is connected to `callstackincubator/codex-mobile-dev-plugin` through Vercel's GitHub integration, with **Root Directory** set to `website` and **Include source files outside of the Root Directory** disabled.

Branch pushes create Preview deployments, including branches with draft pull requests. Vercel adds its deployment check and preview link to the pull request. Each branch gets an initial preview; later pushes skip the build when `website/` has not changed since that branch's last successful deployment. Automatic production builds are skipped, preserving manual production publishing. These rules live in the project's **Ignored Build Step** setting:

```sh
if [ "$VERCEL_ENV" = "production" ]; then exit 0; fi
if [ -z "$VERCEL_GIT_PREVIOUS_SHA" ]; then exit 1; fi
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .
```

Vercel interprets exit code `0` as skip and `1` as build. The command runs inside `website/`. Preview deployments retain the project's Vercel Authentication protection; use Vercel's sharing controls when inviting reviewers who are not on the team. The native Git integration handles deployment, so no GitHub Actions deployment workflow or repository token is needed.

The production environment pins `SITE_URL` to that temporary public origin. Preview builds use their generated deployment URL. `.vercelignore` excludes local QA reports, screenshots, and generated Astro/build output from CLI uploads.

The final production domain is undecided. Transfer the project to its eventual owner later, attach that domain, and update `SITE_URL` and the root README’s website/banner URLs. Then verify the sitemap and register the final origin in Search Console. Configure a redirect from the unused www or apex hostname to the chosen canonical hostname when attaching DNS.

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
