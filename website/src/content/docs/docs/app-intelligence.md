---
title: App Intelligence
description: Trace Expo Router and React Navigation screens through their source files, assets, and packages without building or running the app.
---

Open **App Intelligence** to see how each screen reaches the source files, assets, and packages it depends on. It statically analyzes an Expo Router or React Navigation project, so it does not need a running device, Metro, or an App Flow map.

App Intelligence answers source-structure questions. Use [App Flow](/docs/app-flow) when you need a map of runtime navigation, screen captures, UI states, or recorded paths through the running app.

## Generate a graph

Choose the React Native project folder in the panel, then choose **Generate**. You can also ask your agent:

> Show me the App Intelligence for this project.

The analysis discovers Expo Router routes and React Navigation screen registrations, then follows static imports for iOS and Android. It understands project-relative path aliases and platform-specific module resolution. Source files and assets remain individual nodes; third-party packages are shown as leaf nodes rather than expanding their internals.

Generation reads the project but does not modify, build, or launch it. If source files change, choose **Regenerate** to replace the saved snapshot.

## Read the graph

The first view groups entry points by architectural area, such as navigation, components, state, or API and data. Select an area, open the entry-point list, and choose a screen to trace its dependency flow.

The flow starts at that screen and follows its component, layouts, imports, assets, and packages. Groups can be folded to reduce detail, expanded to show every entry, or highlighted to follow one boundary across the graph. Platform markers identify dependencies that resolve only for iOS or Android. A file or package's reach count is the number of screens that depend on it.

Use the filter to search screen titles, routes, IDs, and source paths, or to show only selected areas.

## Ask the agent about dependencies

Your agent can query the saved graph without opening the view. For example:

- “What does the Checkout screen depend on?”
- “Which screens import `src/components/Price.tsx`?”
- “Find files related to authentication in App Intelligence.”
- “Show the dependency graph for the Profile screen.”

Screen queries can follow outgoing dependencies or incoming consumers. File queries can find imports, importers, and the screens connected to a project-relative path. The agent starts with a compact result and can request more depth or pages when needed.

Static analysis cannot prove relationships created only at runtime. Unresolved imports or screen components appear as diagnostics, and dynamic behavior may be absent from the graph.

## Saved data and clearing

Each project has one saved snapshot under `~/Library/Application Support/mobile-dev/app-intelligence`. It contains project-relative paths, screen names and routes, package names, dependency relationships, and diagnostics. The selected project and up to eight recent project paths are also remembered locally.

Choose **Clear** to delete the selected project's graph. The project remains selected and in the recent-project list, so it can be analyzed again. App Intelligence graph contents and project paths are excluded from Mobile Dev's Sentry telemetry. Results rendered by or returned to your host follow the host's own handling; see [Privacy](/docs/privacy).
