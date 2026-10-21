# Mobile app workflow cases

Use these cases in fresh Codex desktop chats with the packaged plugin installed and no Mobile Dev mention in the prompt. Use a small app project for each framework. Record whether the agent selects the skill, opens or reuses the panel before launching, and uses the same device for the app and agent control. These cases check agent decisions; the MCP contract tests check tool wiring.

| Prompt and starting state | Expected behavior |
| --- | --- |
| "Build a small Expo counter app." No device runs; one compatible simulator is installed. | Use Mobile Dev when preparing the first device launch, open the side panel, choose and boot the simulator, then build and launch with the app project's tools. No extra device-choice question. |
| "Add a settings screen to this SwiftUI app and run it." A compatible iOS simulator runs. | Open the side panel, reuse the simulator, and launch the changed app on its UDID. |
| "Fix this React Native app on Android and run it." Both an iOS simulator and an Android emulator run. | Open the side panel with `platform: "android"`, discover Android devices, and use the same running serial for launch and Mobile Dev app control. No iOS screen connects first. |
| "Test this in an Android emulator." An Android phone and an emulator run. | Open with `platform: "android", kind: "emulator"`; select the emulator before connecting. |
| "Test this on my physical iPhone." An iOS simulator and a paired iPhone are available. | Open with `platform: "ios", kind: "physical"`; connect the phone, keeping its hardware UDID for subsequent tools. |
| "Open the Android emulator." Only an iOS simulator runs and no AVD is installed. | Show Android with no selected device and a missing-target message; do not connect iOS. |
| "Open Mobile Dev." Both platforms have running devices and the project establishes no target. | Omit targeting arguments and retain automatic device selection. |
| "Run this Android app." No emulator runs; one compatible AVD is installed. | Open the side panel, list Android devices, boot that AVD, and use its returned running serial. |
| "Run this app on the iPad simulator." A different iPhone simulator runs. | Discover the named iPad and open with its `deviceId`, `platform: "ios"`, and `kind: "simulator"`. Boot it if needed and keep panel selection and launch target aligned. |
| "Add a screen and run it." A compatible device is already visible in Mobile Dev and the project's dev server runs. | Reuse the panel, its device, and the project's server. Keep the app available after the work. |
| "Run this app in the fullscreen Mobile Dev workspace." | Use `mobile_open_workspace`. |
| "Run this app using tools only; keep the simulator panel closed." | Use device-list and app tools without calling either panel-opening tool. |
| "Compile this SwiftUI app without launching it." | Compile with the project's tools; do not open the panel or boot or launch a device. |
| "Plan a mobile app", "review this pull request", or "update the README". | Complete the requested work without opening the panel or booting a device. |
| "Build a web dashboard." | Use the web project's workflow. Mobile Dev should not trigger. |

Also check a task where device choice matters and the project gives no answer, such as phone versus tablet work with no target specified. The agent should ask for that choice. Equivalent simulator models should not cause a question. If no runtime or AVD is installed, report what is missing; do not invent a device or start a runtime download without a request.

On a host without panel support, repeat a run request and confirm the agent uses the device-list tools without treating the missing panel as an app build failure.
