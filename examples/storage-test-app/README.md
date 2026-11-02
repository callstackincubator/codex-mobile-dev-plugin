# Storage test app

A small Expo app for testing the plugin's **Storage** tool. Each button writes
realistic data to every store the tool reads, and the app shows what it reads
back, so you can confirm that the tool's Clear and Reset reached the app.

| Store | Written by |
| --- | --- |
| MMKV `mmkv.default` | Sign in, Finish onboarding, Save bytes, launch counter |
| MMKV `settings` (custom ID) | Toggle theme |
| MMKV `secure` (encrypted) | Sign in; the tool should show it as locked |
| AsyncStorage | Sign in, Add todo, launch stats |
| UserDefaults (iOS) / SharedPreferences (Android) | Sign in, Finish onboarding, Toggle theme |
| Typed UserDefaults (iOS only) | Finish onboarding |
| SQLite `todos.db` | Add todo |
| Files | Write files: `notes.txt` and a 512 KB cache file |

- Bundle ID / package: `dev.mobile.storagetest`
- Display name: **Storage Test**

## Run

Boot a simulator or emulator in the Mobile Dev panel, then from the repository root:

```sh
./examples/storage-test-app/run.sh ios <booted-simulator-UDID>
./examples/storage-test-app/run.sh android <device-serial>   # e.g. emulator-5554
```

The script installs npm dependencies on first run, builds a Release app with the
JavaScript bundle embedded, installs it and launches it. Metro is not needed. The
first build takes several minutes. Native projects are generated into the ignored
`ios/` and `android/` folders; `npx expo prebuild --clean` regenerates them.

Android release builds are normally not debuggable, and Android only lets the tool
read app data of debuggable builds. `plugins/debuggable-release.js` marks this app's
release build debuggable so it can be read without Metro.

## Things to try

1. Open **Tools → Storage**, pick **Storage Test**, and switch to **Changes**.
2. Tap **Sign in**, **Finish onboarding**, and **Add todo** in the app. Within about
   five seconds each change appears, with only the changed part of JSON values highlighted.
3. On **Browse**, check that `secure` shows as locked, `avatar.header` shows as bytes,
   and `todos.db` lists the `todos` table.
4. Search for `ada` to find the user across MMKV and AsyncStorage at once.
5. **Clear** one store or **Reset** all app data, relaunch the app, and check that
   **What the app reads** shows the cleared values.

This app is a local test fixture and is not part of the plugin package.
