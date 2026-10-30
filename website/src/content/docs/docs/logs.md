---
title: Logs
description: Read native iOS, Android, and Metro logs together, filter the running app, and share an error with your coding agent.
---

Open **Logs** to read native and JavaScript messages together. Logs follow the foreground app on the selected device by default; opening Logs does not launch, restart, or attach a debugger to the app.

## Choose the sources

The native source follows the device selected in the panel. You can choose another connected Android device for logs in **Log sources**.

For Metro, enter the URL of your existing local server and choose **Find sources**. Select the app and device under **Metro app**. An explicitly chosen Metro target stays connected until you change it; an app restart may require you to refresh the targets.

Use **JS** and **Native** to toggle the sources, and **Info**, **Warn**, **Error**, and **Debug** to choose levels. Metro needs a compatible app inspector target. Android needs `adb` from an installed Android SDK.

## Follow the foreground app

The search field includes an editable clause such as `app:"com.example.app"`. App switches update this clause while preserving your other search terms and buffered logs.

Edit or remove the app clause to control the visible apps yourself. Use **Follow foreground app** in **Log sources** to enable automatic following again. Selecting another Android log device also disables foreground following.

## Search and filter

Plain keywords match the message, stack trace, and metadata. Spaces mean AND; quote a phrase to keep it together. Common filters include:

| Query | Result |
| --- | --- |
| `level:error` | Errors |
| `app:com.example.app` | One exact app ID |
| `pid:123` | One exact process ID |
| `age:5m` | Recent messages |
| `level:error message:network` | Network errors |
| `level:error level:warn` | Errors or warnings |
| `-message:noise` | Exclude a message term |
| `network & (timeout \| failed)` | Combine explicit operators |
| `message~:"error.*timeout"` | Match a regular expression |

The help button beside the search field lists the supported fields and examples. Invalid syntax shows an inline error until corrected.

## Read and share an error

Click a row to read its complete message and stack trace. **Attach to chat** adds the original log, source, and repeat count to your next prompt. Ask the agent about that error in your next message.

You can also right-click a row and choose **Fix in chat** or **Ask in chat** to send it with a short request. Hosts without context pills receive the full log in the message. Review logs for sensitive information before sharing them.

## Control collection

- **Stack** groups exact repeats and shows their count.
- **Follow** keeps the latest rows in view. Scrolling away turns it off; returning to the bottom turns it on.
- **Pause** stops the readers; **Resume** starts a new session.
- **Clear** removes buffered rows while collection continues.
- Closing the tools panel stops collection.

While Performance is visible, collection can continue in a bounded buffer. Returning to Logs restores the retained rows, filters, selection, and scroll position.

## iOS details

**Hide iOS system noise** is enabled by default. It excludes routine Apple subsystem chatter while preserving errors, faults, warnings, and app subsystems. Changing this setting restarts collection and clears current logs; previously excluded records cannot be recovered.

Physical iOS logs use the existing paired USB or Wi-Fi connection. Unified logs exclude ordinary `print` and `printf` standard output, and the operating system may redact private values. Metro console messages are available through the JavaScript source.
