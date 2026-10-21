# Native Storage iOS test app

A dependency-free SwiftUI app that writes realistic data through the standard iOS
storage APIs. It is a fixture for the plugin's app storage reader. Requires Xcode 26+
and iOS 18+.

## Run

Boot an iOS simulator, then pass its UDID from the repository root:

```sh
./examples/native-storage-ios/run.sh <booted-simulator-UDID>
```

The script builds Debug, installs, and launches on that simulator. It signs ad hoc
so the App Group entitlement is embedded; the simulator only creates the group
container for a signed entitlement. Build output stays in the ignored `.build/`
directory.

- Bundle ID: `dev.mobile.nativestoragetest`
- App Group: `group.dev.mobile.nativestoragetest`

## What each button writes

| Button | Location | Data |
| --- | --- | --- |
| Sign in | `Library/Preferences/dev.mobile.nativestoragetest.plist` | UserDefaults strings, numbers, a date, an array, a dictionary, raw bytes, and a Codable value |
| Sign out | same file | Removes the keys above |
| Write App Group | the App Group container | Shared UserDefaults and `widget-timeline.json` |
| Add Core Data note | `Library/Application Support/Notes.sqlite` | One `Note` row, from a model built in code |
| Add SwiftData task | `Library/Application Support/default.store` in the App Group container | One `TodoItem` row; SwiftData uses the group container when the app has an App Group |
| Write files | `Documents/` and `Library/` | `profile.json` (Codable JSON), `state.plist` (binary plist), `session.archive` (NSKeyedArchiver), `notes.txt`, and a 256 KB cache file |

The list under the buttons shows what the app reads back, so a cleared store shows
up as missing in the app too.
