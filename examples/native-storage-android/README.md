# Native Storage Android test app

A small Kotlin app (plain `Activity`, no Compose, no Room or code generation) that
writes realistic data through the standard Android storage APIs. It is a fixture for
the plugin's on-device storage reader. Requires JDK 17, the Android SDK (API 36), and
an arm64 emulator or device running Android 8.0+.

## Run

Boot an emulator, then from the repository root:

```sh
./examples/native-storage-android/run.sh <device-serial>
```

The script builds the release variant with the Gradle wrapper, installs it with
`adb -s <serial> install -r`, and launches it. The release build type is
**debuggable** and signed with the debug keystore so the plugin can read app data
with `adb shell run-as`. It packages only `arm64-v8a` native libraries (MMKV).

- Package: `dev.mobile.nativestorage.android`
- Label: Native Storage
- Versions: AGP 8.13.2, Kotlin 2.2.21, Gradle 9.4.1

## What each button writes

| Button | Location | Data |
| --- | --- | --- |
| Sign in | `shared_prefs/dev.mobile.nativestorage.android_preferences.xml` | `user.name`, `user.id`, `isLoggedIn`, `lastLogin`, `fontScale`, `interests` (string set), `session` (JSON string) |
| Sign out | same file | Removes the keys above |
| Save secret | `shared_prefs/secret_prefs.xml` | `EncryptedSharedPreferences` (AES256_GCM master key): `api_token`, `pin` |
| Add note | `databases/notes.db` | One row per tap in `notes(id, title, body, pinned, created_at, thumbnail BLOB)` |
| Toggle theme | `files/datastore/settings.preferences_pb` | Preferences DataStore `settings`: `theme`, `notifications`, `launchCount` |
| Save profile | `files/datastore/profile.pb` | Proto DataStore with a hand-written protobuf wire-format serializer (name=1, age=2, premium=3, tags=4, address=5 with city=1, zip=2) |
| Write MMKV | `files/mmkv/mmkv.default`, `files/mmkv/cache` | Default instance (`user.name`, `launchCount`, `onboarded`) and the `cache` instance |
| Write files | `files/notes.txt`, `files/profile.json`, `cache/image-cache.bin` | Text, pretty JSON, 256 KB of random bytes |
| Clear everything | all of the above | Clears or deletes the data from inside the app |

A summary under the buttons shows what the app reads back after each tap.

## Inspect

```sh
adb -s <serial> shell run-as dev.mobile.nativestorage.android ls -R
```

Build output stays in the ignored `.gradle/`, `build/`, and `app/build/` directories.
This app is a local test fixture, excluded from plugin packaging.
