---
title: Devices
description: Open iOS and Android devices beside your chat, share a target with your agent, and inspect or annotate the running app.
---

Mobile Dev streams iOS simulators, Android emulators, and connected physical devices beside your conversation. You and your agent work with the same selected target.

## Open the workspace

Ask your agent to open the simulator beside chat, or open Mobile Dev from the Codex sidebar. Ask for fullscreen when you want a larger workspace. You can specify a target in your request:

- “Run this app in an Android emulator.”
- “Open the iPad simulator beside this chat.”
- “Test this on my physical iPhone.”

Use the platform menu to show iOS, Android, or both. Pick a device from each panel's dropdown. Selecting a stopped simulator or AVD boots it and starts its stream. Opening the panel by itself does not boot a device.

The agent reuses a suitable selected or running device when the task establishes the target. It may ask you to choose when the choice affects the task.

## Interact with the app

Click the device screen to focus it, then tap, drag, or type where supported. Home and app-switcher controls are in the toolbar; Android also provides Back, Recents, and Lock.

On iOS simulators and Android screens, **Command-V** pastes up to 4,096 printable US-ASCII characters. Unsupported characters or line breaks show a notice without sending partial text. Paste is unavailable while **Select** is active or the stream is not ready.

Use **Screenshot** to attach a PNG to your next message and copy it to the macOS clipboard. Capturing a screenshot does not send a message.

## Inspect and annotate

Choose **Select** to pause the screen. Hover to outline an element, then click it and leave an instruction for your agent. React Native development apps can provide component and source details where available. Drag to mark a region when no element can be selected.

Saved annotations appear as numbered bubbles. Click a bubble to edit or remove it, then use **Send to chat** to share the notes. Annotation text and available element details attach to the conversation; annotations do not attach screenshots.

## Physical iPhone and iPad

Pair the device with Xcode and enable Developer Mode. Connect it by USB, or enable wireless connectivity in Xcode. Physical iOS discovery requires Xcode 27 or later; mirroring also requires HEVC WebCodecs support in the host.

Choose the phone under **Connected devices**. Physical iOS supports taps, long presses, and drags. Keyboard input and hardware-button controls are unavailable. Screenshots and region annotations require a ready mirrored frame; native accessibility component names are unavailable in that view.

Close Device Hub's mirroring window while using Mobile Dev's physical iOS mirroring.

## Physical Android devices

Enable USB debugging and authorize your computer, or pair the device for wireless debugging. Choose it under **Connected devices**. Offline or unauthorized devices remain visible with their connection state.

The host needs H.264 WebCodecs support for streaming. Physical Android devices support screen input, screenshots, native logs, and performance tools; emulator boot and stop controls do not apply to phones.

## Keep the target consistent

The selected device is shared with the agent. If you switch devices, the agent should use that choice for subsequent app operations. Click a device panel to make it the active source for tools such as logs and performance.

Closing a panel closes its screen stream. Android devices and emulators remain running. For missing tools or platform setup, check [Requirements](/docs/getting-started#requirements).
