# Resource-saving measurements — 2026-11-05

Mobile Dev 0.1.179's bundled profiles reduce the host memory footprint of the
selected iOS simulator by **45.8%** and Android emulator by **16.4%** in this idle
comparison. These are measurements of the plugin's actual start adapters and
profiles, rather than the upstream projects' headline benchmarks.

Host: Apple M2 Pro, 12 CPU cores, 32 GiB RAM, macOS 27.0.1 (26A434).

| Device | Stock footprint | Optimized footprint | Reduction | Stock idle CPU | Optimized idle CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| iPhone 18 Pro, iOS 27.0 | 1,503.4 MiB | 814.9 MiB | 688.5 MiB / 45.8% | 0.841% | 0.128% |
| Pixel 8, Android 15 / API 35, AOSP arm64 | 3,367.0 MiB | 2,813.9 MiB | 553.1 MiB / 16.4% | 0.238% | 0.183% |

Values are the mean of three runs per mode. CPU is host process CPU time divided
by measured wall time: 100% represents one host CPU core. These very low idle
values do not establish an improvement to app execution speed, frame rate, or
interaction latency. Android CPU ranges overlap, so its average reduction should
not be presented as a reliable general CPU speedup.

## Repeated results

| Device and mode | Memory range across run means | Idle CPU range across runs | Mean host process count |
| --- | ---: | ---: | ---: |
| iOS stock | 1,491.5–1,519.2 MiB | 0.656–0.995% | 169.4 |
| iOS optimized | 806.9–820.0 MiB | 0.101–0.160% | 98.0 |
| Android stock | 3,323.1–3,399.0 MiB | 0.205–0.291% | 1.0 |
| Android optimized | 2,786.9–2,835.7 MiB | 0.125–0.221% | 1.0 |

Android guest processes live inside QEMU; its host process count therefore stays
at one. The iOS count includes the simulator's launchd process and descendants.
Shared CoreSimulator helpers, the plugin server, browser UI, and unrelated
emulators are excluded from both device totals.

## Method

- Existing devices selected by the user; no cloned devices, erases, or app-data
  resets. Both selected devices were stopped after the comparison.
- Three alternating stock/optimized pairs. Each run cold-started the selected
  devices through `Baguette.changeDeviceState` and `ServeEmu.boot`, with the same
  `ResourceSaving` service used by the plugin.
- At least 30 seconds settling after both start paths completed, then 31 process
  snapshots at roughly one-second intervals. Actual CPU windows were
  30.18–30.29 seconds and use their observed monotonic duration.
- Memory is summed host `phys_footprint` from `proc_pid_rusage`, including charged
  compressed memory, rather than guest free RAM or summed RSS. CPU uses differences
  of cumulative user plus system CPU time for the same PID and process start
  identity at consecutive boundaries. Short-lived processes absent at either
  boundary do not contribute their missing interval CPU time.
- Idle after boot; Android was explicitly returned to its Home screen. This
  comparison does not include an application workload or a live stream benchmark.
- Telemetry was disabled for the benchmark. The process readings stay in these
  local artifacts and are not sent to Sentry.

The Android AVD is already a plain AOSP image, with 2 GiB configured guest RAM.
Both modes use host GPU acceleration and bypass snapshots. The optimized mode
adds `-lowram -memory 1536` and the plugin's avdslim package profile. Consequently,
the measured saving here is much smaller than a comparison starting with a
Google-heavy image or software GPU rendering. It should not be generalized to
Google APIs or Google Play images without measuring those separately.

The iOS profile keeps store/push, web/universal-link, personal-information,
photo-picker, connectivity, and diagnostic categories. Android retains location,
Bluetooth, animation, synchronization and process-limit settings, and keeps
camera, photo, contact, maps, speech, accessibility and tracing packages.

## Reproduce

After building the plugin and choosing the two devices explicitly:

```sh
MOBILE_DEV_TELEMETRY=off node tooling/benchmark-resource-saving.ts \
  --ios <simulator-UDID> --android <AVD-name> \
  --rounds 3 --settle 30 --seconds 30 \
  --output /tmp/resource-saving.json.gz
```

This command restarts the selected devices and changes their managed background
services for the comparison. It preserves app data and stops them afterward.
The mode preferences used by the benchmark live in a temporary directory.

[Aggregate values and configuration](resource-saving-2026-11-05-summary.json)
and [original process snapshots, compressed JSON](resource-saving-2026-11-05.json.gz)
are included for inspection.
