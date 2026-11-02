# Mobile Dev site brief

Status: approved homepage and 404, Starlight docs, social card, and the README banner are complete. The site is deployed temporarily under Margelo at https://mobile-dev-snowy.vercel.app. The approved expanding ADE direction uses a ticket-led coding story and separate performance/storage demos.

- **What it is (user wording):** Plugin for mobile development in your ADE. Supports Codex, Claude, Cursor, and many more.
- **For:** Mobile developers and their coding agents, working together.
- **Name / wordmark:** Mobile Dev / MOBILE DEV. Keep the product independent of any one coding environment.
- **Biggest selling point (confirmed direction):** Mobile development tools inside your existing ADE, across Codex, Claude, Cursor, and other compatible environments. Describe Mobile Dev as a plugin, not as the ADE itself.
- **Headline (working two-beat adaptation):** Mobile development. / In your ADE.
- **Positioning line (user wording, capitalization normalized):** Plugin for mobile development in your ADE. Supports Codex, Claude, Cursor, and many more.
- **Demo story (user-approved refinement, illustrated ticket):**
  1. A developer asks, “Work on MOB-142.” The ticket is an illustrative example, not an issue-tracker integration claim.
  2. The ADE expands to reveal Mobile Dev and the running app beside chat.
  3. The developer asks, “Change the title to My trips.”
  4. The agent edits the app; the visible title changes from Trips to My trips. The project's tools build/reload the app; Mobile Dev supplies the device view and inspection.
  5. The page continues with separate performance profiling and storage inspection demos, rather than one long hero loop.
- **Real tools for possible illustrations:** mobile_open_simulator, mobile_list_ios_devices, mobile_list_android_devices, mobile_record_performance. Verify arguments from docs before drawing the final transcript.
- **Install:** Codex plugin directory link: https://chatgpt.com/plugins/plugins_6ac4c117f76881918d3676e851fa4005 . Claude Desktop and Cursor are manual previews; the standalone Mac app is source-build only.
- **Setup:** Install the plugin for your environment; start a new conversation; ask “Open Mobile Dev” and choose a device. Platform tools must already be installed.
- **Host order:** Codex, Claude, Cursor, and more. Installation docs distinguish Claude Desktop and Claude Code and explain rich-panel requirements for other MCP clients. Mention Mac app separately.
- **Device order:** iOS, Android; simulators/emulators, then physical devices.
- **Frameworks:** Expo, React Native, SwiftUI, and other native mobile projects.
- **Requirements:** Apple Silicon Mac; iOS simulator requires Xcode 26+, physical iOS discovery Xcode 27+; Android SDK/emulator or authorized device.
- **Features:** Live devices beside chat; human and agent device control; element and region annotations; app launch, permissions, deep links and device settings; native and Metro logs; CPU/memory and supported device Display FPS; TraceSift profile analysis; app storage inspection.
- **Limits:** Mobile Dev does not build the app itself; simulator Display FPS is unavailable; host capabilities affect panel presentation; physical iOS input and inspection have documented limits.
- **Privacy:** Local device tooling; do not claim zero telemetry. Plugin Sentry reporting excludes screenshots, app logs, tool payloads, input content, profiles, storage contents and device performance recordings. Link to existing privacy and terms pages.
- **Experimental:** No blanket experimental claim. Claude/Cursor distribution status is a manual preview, not a public marketplace install.
- **FAQ:** Which environments? Which mobile frameworks? Physical devices? Requirements? Does this build my app? What telemetry is collected? Answers sourced from README and docs.
- **Do not invent:** Adoption numbers, benchmark claims, testimonials, marketplace availability, cloud build services, universal feature parity between device kinds.
- **Product vocabulary for scene design:** devices, streams, panels, shared screen, annotations, traces, logs, recordings, inspect, tap, type.
- **Source:** Current local README, CONTRIBUTING, docs/devices.md, docs/agent-workflow.md, product package manifests.
- **Links:** https://github.com/callstackincubator/mobile-dev ; support mailto:hello@callstack.com ; MIT license in the repository. Production domain not confirmed.
- **Hosting / docs (confirmed):** Vercel; Astro with Starlight documentation, adapted from current user-facing docs. Leave contributor and implementation details in GitHub.
- **Location (confirmed):** website/ inside the current repository. No existing website found.
- **Pages (proposed):** Home, getting started with environment-specific installation, devices, logs, performance, storage, FAQ, privacy/terms links, custom 404.
- **Theme (confirmed refinement):** Dark only across the website, Starlight docs, and README banner. Remove theme controls, system-theme detection, and the light palette.
- **Accent (confirmed):** Signal blue #6f9dff, hover #abc6ff. Text contrast is 7.49:1 on near-black.
- **Signature scene / hero motion (user refinement):** Mobile Dev extends the ADE itself. Start with a compact chat workspace, grow its enclosing frame to reveal the phone as an integrated side panel, then show incoming chat messages and a corresponding app update inside the same workspace. Hero: “Work on MOB-142,” the device panel opens inside the ADE, “Change the title to My trips,” the agent edits App.tsx, and the running app title updates from Trips to My trips. The ticket is illustrative. Separate sections demonstrate performance recording and storage analysis. Keep performance available in feature sections rather than making it the primary metaphor. Use the selected Signal blue, square hairlines, stepped device corners, and a subtle dither echo of the expanding frame on the dark background.
- **Selected composition:** A’s objective wording with B’s split header layout and tool-guide bar. The first section after the hero is “A mobile IDE in your ADE,” followed by environment setup, performance, storage, and FAQ. Place actions below the left headline and vertically center the right description and environment list against that block. Remove the top-right example ticket card. MOB-142 in the demo gets a curled underline and a ticket preview on hover, keyboard focus, or tap.
- **Homepage actions (confirmed refinement):** Primary Install buttons open an ADE picker with ChatGPT/Codex, Claude, and Cursor. The shared ChatGPT plugin store is the direct install destination; Claude and Cursor currently link to their manual installation guides because their packages are not published by the release workflow. The hero's secondary Get started link opens the documentation.
- **Copy preference for this website:** Objective, precise product copy that directly explains what Mobile Dev does.
- **Demo labels (confirmed refinement):** Omit “example,” “illustrative,” and similar labels and notes from the homepage diagrams, ticket preview, and accessibility descriptions. Use direct descriptions of the displayed content.
- **Performance copy (confirmed refinement):** “Performance profiling / Using the right tools.” Lead with the agent performing the interaction and recording data, followed by reviewing the results together.
- **Reveal motion:** Keep the ADE frame’s stepped expansion. Reveal text and the phone panel at full opacity in clean steps so their contrast stays readable throughout the animation.
- **404 page (confirmed):** Keep the empty-workspace wording and the hollow scene with a dashed outline where the phone is missing.
- **Initial hosting team (confirmed):** Margelo for now, using the `mobile-dev` project and public address https://mobile-dev-snowy.vercel.app. Move to the eventual owner and final domain later. Production `SITE_URL` uses this public project domain; preview builds use their generated deployment URL.
- **Docs font loading (confirmed):** Preload Switzer Regular/Medium and Geist Mono Regular/Medium, matching the homepage’s early font loading.
- **README banner (confirmed):** Use a dark banner with the wordmark, headline, and large dithered workspace-and-phone scene. Omit the miniature chat UI so the banner reads clearly at GitHub sizes.
- **Outstanding decisions:** Choose the production domain and eventual hosting owner.
