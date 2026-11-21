# Windows Android emulator RAM profile

The Windows profile passes one launch argument, `-memory`, to the Android
Emulator. The next stock start uses the RAM in the AVD configuration. The
profile changes neither Android's low-RAM mode nor its package settings.

## Device checks

Two isolated x86_64 Medium Phone AVDs used WHPX, four guest cores and
a 1080 × 2400 display on Windows 11 Pro x64 (build 26200), with an AMD
Ryzen 7 7700X, Android Emulator 37.3.10 and Platform-Tools 37.0.1.
Mobile Dev's MCP tools set the preference, started and stopped the AVDs,
and installed and launched a test APK. Each device cold booted at its stock
allocation, then with the profile on, off, on and off.

The test checked the effective allocation in `hardware-qemu.ini`, guest
`MemTotal`, the installed APK digest and an app-private value written on first
launch. It also compared user 0's installed and enabled flags and checked that a
deliberately disabled Print Spooler retained its `disabled-user` override.

Each idle reading averaged 11 one-second-spaced samples of the QEMU process
after 15 seconds on the Home screen with no stream open. Working set measures
resident pages. Private bytes measure committed private memory. The initial
setup boot is excluded from mode comparisons.

| Final Windows package | Boots per mode | Effective guest RAM, stock → profile | Host working set, stock → profile | Host private bytes, stock → profile |
| --- | ---: | ---: | ---: | ---: |
| Android 16, API 36 Google APIs | 1 | 4096 → 2560 MiB | 4401.6 → 3344.0 MiB | 5806.9 → 4311.0 MiB |
| Android 17, API 37.0 Google Play | 2 | 6144 → 4096 MiB | 5560.1 → 4905.8 MiB | 7876.8 → 5824.0 MiB |

On API 36 the final package repeated the on/off pair on the same AVD after
the initial five-boot development run. All 250 package overrides matched their
baseline. On API 37 the final package ran the entire sequence. During initial
setup, an NFC package changed from default to disabled. Android recorded the
package itself as the caller. A separate fresh API 37 AVD reproduced the
transition at stock RAM without ever enabling the profile.
The installed APK, private app data and disabled Print Spooler survived every
cold boot. A fresh MCP server also recognized the active RAM profile without
requesting another restart on both images. The configured RAM stayed the same.
On first use the emulator increased its data partition from 4 to 6 GiB.
These idle samples cover one host
and two images. Memory under app load and performance on API 35 were not measured.

## Why Windows package pruning is deferred

In a separate API 36 Google APIs experiment, avdslim removed its restore record
and reported success. After an immediate emulator stop and cold boot, 38 of 38
managed packages were still disabled with 1.0.16 and 11 of 38 with 1.0.17
(172 ms between the latter restore and stop). An orderly guest shutdown restored
40 of 40 on the API 37 Google Play image in one run.

A second issue occurs when there are zero managed packages. Upstream can write
`disabled_packages: null`, which the existing Mobile Dev reader rejects.
In a synthetic adb test, the released Windows x64 1.0.17 binary issued
`pm enable` for 70 distinct targets with either `null` or `[]`. It changed a
previously disabled test package from disabled-user (3) to explicitly enabled
(1). With one managed package, restoration changed its original default (0) to
explicitly enabled (1). A Windows package optimizer
would need a durable per-user record of the original overrides and recovery that
can verify the result after a cold boot. [avdslim 1.0.17 source](https://github.com/kdbhalala/avdslim/tree/v1.0.17)
