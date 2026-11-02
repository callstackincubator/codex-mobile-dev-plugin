---
title: Introduction
description: Bring devices, logs, performance, and app storage into your ADE so you and your coding agent can work on the same running app.
---

Mobile Dev is a plugin for mobile development in your agentic development environment (ADE). It brings iOS and Android devices beside your conversation, with tools to inspect the running app, read logs, record performance, and explore app storage.

It works with Expo, React Native, SwiftUI, and other native mobile projects. Your project's own tools build and run the app. Mobile Dev supplies the device workspace and the information you and your agent use to work on it.

## Work on the app in your ADE

Start with your normal development request, such as:

> Build and run my Expo app in the simulator beside this chat.

The agent opens Mobile Dev, selects a suitable installed device, and uses the project's build tools. You can watch and interact with the same app while the agent works. Ask for a change, annotate a screen element, or attach a relevant log to continue the conversation.

## Tools for the full workflow

| Task | Guide |
| --- | --- |
| Select simulators, emulators, or physical devices; inspect and annotate the screen | [Devices](/docs/devices) |
| Install or relaunch an app, open a deep link, change permissions, or test another language | [App control](/docs/app-control) |
| Read native and Metro messages together and send a log to your agent | [Logs](/docs/logs) |
| Record CPU, memory, and supported device Display FPS; select and compare ranges | [Performance](/docs/performance) |
| Explore a CPU or React profile and investigate a measured finding | [Profiles](/docs/profiles) |
| Browse persisted values, SQLite tables, files, and changes while the app runs | [Storage](/docs/storage) |

## Development environments

Mobile Dev supports Codex, Claude, Cursor, and other compatible MCP clients. Installation and presentation depend on the host. Codex has a plugin-directory installation; Claude and Cursor currently use manual previews or a source build. Device panels and interactive cards require the host's MCP Apps support.

[Getting started](/docs/getting-started) covers installation and platform requirements. A standalone Mac app can also show the tools in its own window; it has no chat and currently requires a source build.

## Local tools and sharing

Device tools run on your computer and connect to your chosen devices and development services. Results shown in your host or sent to chat are available to that host. Plugin diagnostics are enabled by default and can be disabled. Read the [Privacy Policy](/docs/privacy) for the data boundaries and controls.
