# Mobile Dev design

Mobile Dev uses the Callstack product family’s near-black palette, one bright accent, tightly tracked grotesk headlines, uppercase mono labels, square corners, hairlines, and dithered pixel imagery. Signal blue comes from the connection between an agent workspace and a running mobile device. It sits alongside Appduct’s cyan, Rozenite’s crimson-rose, Apex’s lime, Simlock’s orange, and agent-device’s violet. Use the same visual language for the website, social cards, presentations, diagrams, and videos.

**Scope.** This guide governs Mobile Dev’s brand visuals. The plugin’s device panels and other application surfaces retain their existing component system in `packages/ui`, `packages/mcp-app`, and the host applications.

## Colour

The accent’s source of truth is `website/src/site/brand.ts`. Landing-page neutrals live in `website/src/styles/landing.css`; Starlight’s corresponding neutrals live in `website/src/styles/theme.css`.

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#0a0a0a` | Canvas and solid text cards |
| `surface` | `#111111` | Windows and device panels |
| `field` | `#161616` | Inputs and human chat messages |
| `chip` | `#1a1a1a` | Quiet buttons and attribution |
| `line` | White at 8% | Layout hairlines |
| `line-strong` | White at 16% | Window and card outlines |
| `text` | `#ffffff` | Primary text |
| `muted` | White at 62% | Body text and descriptions |
| `faint` | White at 50% | Labels and comments |
| `device` | `#050505` | Illustrated phone screen |
| `device-line` | `#313131` | Stepped phone outline |
| `accent` | `#6f9dff` | Brand and primary-action fills |
| `accent-hover` | `#abc6ff` | Primary-action hover |
| `on-accent` | `#0a0a0a` | Text on bright blue fills |
| `accent-ink` | `#6f9dff` | Accent text, links, and thin marks |
| `accent-tint` | `#1e273b` | Quiet selected regions |
| `scene-ink` | `#6f9dff` | Brightest dither pixels |

Signal blue has 7.49:1 contrast on near-black; its hover tone has 11.55:1. Use colour tokens inside components. Bright blue fills carry near-black text. Accent text and thin marks use `accent-ink`. Keep neutrals neutral, use blue sparingly, and do not introduce semantic red/green status colours into brand illustrations. Differentiate states with labels, borders, selections, or position. Every text colour must reach 4.5:1 against its composited background.

The website, Starlight docs, social card, and README banner use dark mode only. Do not add a theme selector, system-theme detection, or a light palette. Previous saved theme preferences have no effect. Use the same dark palette for other brand visuals unless the medium requires a separately designed print treatment.

## The mark

The identity is the uppercase **MOBILE DEV** wordmark on a Signal blue rectangle. A smaller neutral **BY CALLSTACK** chip follows it on wide layouts and is hidden in the phone nav. Keep that order, square corners, and near-black wordmark text. The favicon is a near-black **M** on the same blue block. There is no separate pictorial logo.

Keep the lockup on a solid background. Do not add a phone glyph, gradient, glow, outline effect, or rounded container to it.

## Type

Fonts are self-hosted in `website/src/fonts/`. Switzer uses the ITF Free Font License; Geist Mono uses the SIL Open Font License. Font declarations and attribution are in `font-face.css`.

| Role | Face | Website size and treatment |
| --- | --- | --- |
| Main headline | Switzer Medium, 500 | 32–56px; line-height 1.08; tracking −0.035em |
| Section headline | Switzer Medium, 500 | 28–44px; line-height 1.1; tracking −0.03em |
| Card title | Switzer Medium, 500 | 18px; line-height 1.3 |
| Body | Switzer Regular, 400 | 15–18px; line-height 1.5–1.55 |
| Docs title | Switzer Regular, 400 | 40–60px; tracking −0.05em |
| Labels and controls | Geist Mono Regular, 400 | 12px; uppercase; tracking 0.08em |
| Code | Geist Mono Regular, 400 | Mixed case; keep its syntax readable |

Headlines have two beats. The first is the statement; the second carries the accent. The motto is **“Mobile development. In your ADE.”** Let each beat occupy a line when space allows. Mono is for labels, controls, metadata, and code; reading paragraphs use Switzer.

Name environments in this order: **Codex, Claude, Cursor, and more**. Name mobile platforms **iOS, Android**, and example frameworks **Expo, React Native, SwiftUI**.

## Layout

Use a centred frame with continuous vertical hairlines, horizontal section rules, square cells, and generous blank space. The website frame is at most 75rem wide, with 16–32px outer gutters, 20–40px content padding, and 40–80px section rhythm. Section-head rows pair a mono number such as `[01]` with a short label.

Desktop grids use whole rows of two, three, or four cells. Collapse them to two columns on tablets and one column on phones. Check at 1440px, 768px, and 390px. A phone layout keeps its content within the frame and stacks the cause above the effect. Radius is zero, outlines are 1px, and there are no shadows.

For a 16:9 slide or video, retain the rectangular frame, section-head row, and headline-to-body hierarchy. Scale the type as a group and keep one principal idea in the frame. Use a two-column composition for an explanation beside a device or window, then cut to a single enlarged detail when the audience needs to read it.

## Components

- **Lockup:** blue wordmark block, followed by the neutral Callstack chip.
- **Buttons:** square, uppercase mono, 40px minimum height; primary blue with dark text, secondary neutral. Thin arrows indicate a destination.
- **Installation:** primary **Install** buttons open a native dialog with three ADE choices: the shared ChatGPT/Codex plugin store, Claude's manual setup guide, and Cursor's manual setup guide. The secondary **Get started** action opens the docs. The picker uses square link rows, supports keyboard focus and Escape, and returns focus to its trigger when dismissed.
- **Closing:** a blue CTA bar followed by an oversized accent wordmark and a compact mono footer.
- **Windows:** neutral solid surfaces, 1px borders, a mono title row, and small square controls. A phone lives inside the ADE frame to show the extended workspace.
- **Code and transcripts:** neutral foreground; keywords, punctuation, and comments use readable grey; changed text and numeric highlights use `accent-ink`. Human messages have a field fill; agent replies sit directly on the window surface. Show an actual app edit when the story is about coding.
- **Tabs and controls:** square cells, mono labels, an accent underline or selected region, and explicit accessible state. The performance example switches recording ranges; storage switches between before and after values.
- **Marquee:** mono names in the agreed environment, platform, and framework order, separated by small blue squares.
- **Icons:** the crisp unit-square bitmaps in `website/src/components/site/icons.ts`; do not mix in a different icon style.
- **Devices:** a thin stepped outline with solid screen fill, top island, and home indicator. Keep all visible app content inside the screen. Do not use smooth rounded mockup hardware.
- **Product pictures:** factual captures must match the current plugin. Product diagrams use plausible data without personal information. Omit “example,” “illustrative,” and similar labels and notes from the homepage diagrams, ticket preview, and accessibility descriptions.
- **Ticket preview:** a wavy blue underline on `MOB-142`; a square ticket card opens on hover, keyboard focus, or tap. It is an example ticket, not an issue-tracker integration claim.

Command bars are for a real install command that a visitor can use. The homepage sends visitors to environment-specific installation rather than presenting one environment’s command as universal.

## Pixel imagery

Use ordered Bayer dithering on a low-resolution grid, enlarged with crisp pixel edges. There are three colours: the background, a midtone, and the scene ink. The midtone is `#283654`, mixed 30% toward the ink.

The signature **workspace** scene is a wide ADE rectangle with a thin top bar, short horizontal chat lines on the left, and a vertical divider around three-fifths of its width. A tall, narrow, stepped phone sits inside the right-hand region. Its screen contains a small top island and short rows. A restrained sweep brightens existing pixels; it does not add particles or change the composition.

The **flow** scene uses the same workspace geometry at 28% intensity for quiet section backdrops. The **hollow** scene removes the phone’s interior and replaces its outline with alternating dashed pixels. It belongs on the 404 page; the chat workspace remains visible around the gap.

Place text on solid surfaces over the scene. Keep secondary scenes quiet. Do not introduce photos, soft gradients, blurred glows, floating particles, 3D decoration, or the signature motifs of sibling products.

## Motion

Use stepped movement and clean cuts. The hero loops over 12 seconds: the request appears, the ADE grows in 16 width steps, the phone panel appears, the developer requests a title change, an `App.tsx` edit appears, and the phone heading changes from **Trips** to **My trips**. The final reply invites review. Layout reserves room for the largest state.

Text and phone panels appear at full opacity; fades must not lower text contrast. The title change is an immediate before/after cut. Dither and hero motion update at about 12fps, start near the viewport, and pause while hidden or offscreen. The ticket card pauses the demo while open and allows 150ms to move the pointer into it. UI hover transitions are short, around 120–150ms.

Reduced motion shows the meaningful final state at nine seconds, with the integrated phone and updated title. That same state exists in the initial HTML. The scene has one OffscreenCanvas worker implementation, bounded repaint work, and cleanup for observers and timers.

Video follows the same stepped expansion, readable pauses, and cuts rather than cross-fades. Keep the chat request visible long enough to establish the cause before showing the app change.

## Words

Prefer objective, precise copy that explains what the product does. Mobile Dev is a **plugin for mobile development in an ADE**. The ADE is the developer’s existing agentic development environment. Speak to the developer and their coding agent, and show them working on the same app.

Use two-beat headlines and short, specific labels. Page titles are generated by `website/src/site/meta.ts`: **Mobile Dev: Mobile development in your ADE** on the homepage and **Page title | Mobile Dev** elsewhere, including docs and social metadata.

Facts come from the repository’s product docs. Distinguish manual previews from published installation channels, and device-wide Display FPS from app rendering or simulator FPS. Mobile Dev supplies the device view and inspection tools; the project’s own tools build the app. Do not invent adoption figures, speedups, testimonials, marketplace availability, universal host parity, cloud builds, or an absence of telemetry. Keep implementation API names out of headlines and ledes.

## Social card and banner

The social card is `website/public/og-image.jpg`, 1200×630, dark only. It shows the lockup at top left, the motto in two lines, supported environments, and a miniature coding conversation and phone inside one ADE frame. The platform row sits at the bottom right. Keep text on solid fills and preserve the outer safe area.

Run `pnpm --dir website og` to regenerate the card and icons. To select local Google Chrome, use `PLAYWRIGHT_CHANNEL=chrome pnpm --dir website og`. The source is `website/og/og.html`; content, accent, and scene data come from the same modules as the website.

The README banner uses copy on the left and the large dithered workspace-and-phone scene on the right, without an outer frame. It omits the miniature chat UI: the illustration provides the texture, and the headline carries the message at GitHub sizes. `pnpm --dir website og --banner` renders the dark JPEG at 1660×512. The root README uses this banner in every colour scheme. The initial site address is `https://mobile-dev-snowy.vercel.app/`; update the website and banner URLs there when the final domain is attached.

## Website

- `website/src/pages/index.astro`: approved split header, direct product description, actions, and tool-guide bar.
- `website/src/components/home/HeroDemo.astro`, `ticket-motion.ts`, and `ticket-preview.ts`: the expanding ADE, app edit, and ticket preview.
- `website/src/components/home/HomeSections.astro`: mobile tools (“A mobile IDE in your ADE”), environment setup, performance recording, storage inspection, and FAQ, in that order.
- `website/src/pages/404.astro`: the approved empty-workspace message, requested address, recovery links, and hollow scene.
- `website/src/content/docs/docs/`: Starlight guides for installation, devices, controls, logs, performance, profiles, storage, privacy, and terms.
- `website/src/styles/theme.css` and `docs.css`: the dark docs palette, shared fonts, square controls, readable code, hairline sections, and navigation. `website/src/components/starlight/Head.astro` preloads the four fonts used above the fold to avoid a late font swap shifting the page.
- `website/src/components/site/dither.ts`, `dither-host.ts`, and `dither.worker.ts`: scene geometry, visibility, sizing, and the worker renderer.
- `website/vercel.json`: static `dist` hosting with clean URLs and no trailing slash. Set `SITE_URL` to the production origin when deploying so canonical URLs, the sitemap, robots, and social metadata share that origin.

The marketing site sends no remote telemetry. Website work keeps the plugin’s existing Sentry collection separate and preserves its instrumentation and data boundaries.
