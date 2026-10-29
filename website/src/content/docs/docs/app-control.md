---
title: App control
description: Install and relaunch development apps, open deep links, change app permissions and language, and test device conditions from your ADE.
---

Use the app tools in the device panel, or ask your agent to act on the selected device. Availability depends on the platform and device kind; the panel shows the supported controls.

## Install, launch, and stop

Your project's own tools build the app. Mobile Dev can install a built simulator `.app` bundle or Android `.apk`, launch or stop an installed app, and relaunch it after a change or crash.

Use the app picker to choose the intended bundle or package. Ask your agent, for example:

> Relaunch the app on the selected simulator.

Launching an already running app restarts it. This does not rebuild the app.

## Open a deep link

Open a URL from the app tools or ask the agent to open your app's deep link on the selected device. This can take you directly to the screen you are working on instead of navigating there by hand.

## Test permissions

Allow, deny, or reset a supported permission to **Ask** to test first-launch prompts and denied-access states. Permission changes can restart the app.

iOS simulators cannot change camera or notification access through these controls. The available permission list depends on the platform.

## Test another language

Run one app in another language and region, such as German (`de`), Brazilian Portuguese (`pt-BR`), or Arabic (`ar`). Mobile Dev relaunches the app after changing its language. Reset the choice to follow the device language again.

The device's language does not change. Android app-language control requires Android 13 or later.

## Send a test push

Send an APNs payload to an app on an iOS simulator to check notification handling. Android push delivery through Firebase Cloud Messaging is not supported by this tool.

## Change device conditions

Open the panel's device settings to adjust available controls such as appearance, text size, contrast, rotation, location, and the status bar. A clean status bar sets 9:41 with full battery and signal for screenshots.

Network choices include **Normal**, **LTE**, **3G**, **Edge**, and **Offline**. Set these in the panel:

- On Android, throttling applies to standard app networking such as `fetch` and OkHttp, while local development servers such as Metro stay at full speed. Throttling is unavailable when the device already uses its own proxy.
- On iOS, throttling applies to URLSession and `fetch` requests in apps launched after it is enabled. Relaunch your app after changing the setting.

Return the network to **Normal** when the test is finished.

## Inspect or clear app data

Open [Storage](/docs/storage) to inspect persisted values and databases without adding code to the app. Clearing a store or resetting app data deletes data in the selected app and stops it. Confirm the target and keep any data you need before clearing it.
