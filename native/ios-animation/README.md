# iOS simulator animation speed

`MobileDevAnimationSpeed.dylib` makes native iOS animations in an app finish
sooner while App Flow captures it. It is part of the plugin, not of the app:
nothing is added to the app's project, dependencies or bundle.

When App Flow launches an app on an iOS simulator, it passes
`SIMCTL_CHILD_DYLD_INSERT_LIBRARIES`, so the simulator loads this library into
that one app process. The library sets `layer.speed` on the app's windows, the
Core Animation clock UIKit uses for sheets, modals, navigation transitions and
the keyboard. Final layouts are unchanged; only the time to reach them is
shorter. JavaScript, timers, network requests, React state and JavaScript-driven
animations are not affected. Opening the app normally loads it without the
library.

App Flow launches the app with `MOBILE_DEV_ANIMATION_SPEED=10`, so it starts
ten times faster. A run changes the speed through the state of the simulator
notification `dev.mobile-dev.app-flow.animation-speed`, in hundredths: 1000
when a run starts with the library already loaded, and 100 for normal speed
when the run ends. An unset state keeps the current speed; the simulator drops
a state once no process holds its name. On load, the library records its
process ID in `dev.mobile-dev.app-flow.animation-library.<bundle identifier>`,
which disappears when the app quits, so App Flow can tell whether the running
app has it. It reads no app data and sends nothing.

The library only works in the simulator. App Flow copies it to
`~/Library/Application Support/mobile-dev/app-flow/native/` before a launch:
the simulator cannot load a library from a folder macOS privacy protection
covers, such as `~/Documents`.

Rebuild after editing the source with `npm run rebuild:ios-animation`. It needs
Xcode with the iOS simulator SDK.
