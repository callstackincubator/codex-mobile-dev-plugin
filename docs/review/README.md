# Mobile Dev 0.1.132 review

This branch preserves the runtime from tag `v0.1.132`. It adds submission
metadata, legal/support documents and the updated store logo. Website, Privacy,
Terms and Support URLs point to `main`; feature availability is version-specific.
The policies describe workflows conditionally and do not imply that every listed
feature exists in this build.

## Setup

Use an Apple Silicon Mac, Codex desktop with the organization's confirmed local-MCP
submission access, Xcode 26+ and an installed iOS 18+ simulator. Physical iOS
mirroring requires Xcode 27+. Android discovery requires the Android SDK and an
AVD or authorized development device. No Mobile Dev account is needed.

1. Install the package built from this branch, open a fresh chat and run the
   Mobile Dev setup skill. Confirm version 0.1.132.
2. List simulators and select one actual UDID. Boot it if needed. Use this same
   simulator throughout the review.
3. From this source checkout, build, install and launch the fixture:

   ```sh
   ./examples/ios-test-app/run.sh <selected-simulator-UDID>
   ```

   The app is `dev.mobile.testapp`; its log process is `MobileDevTestApp`.
   Start on Interact with the counter at zero. Launching is a setup step:
   this version has no `mobile_launch_app` tool.
4. Run the cases in `.codex-plugin/plugin.json`. Start the log session before
   pressing **Emit test logs** on Diagnostics; close collection afterward.
   Start the performance recording before the five-second CPU workload.
5. Use fresh chats for the three negative cases. Stop fixture work with
   **Stop and release** when finished.

These are test specifications, not evidence of executed checks. Record actual
outcomes and the source SHA/ZIP checksum with the submission.

## Short recording brief

Record the installed 0.1.132 build, with chat/tool activity and simulator visible:

1. List devices and select the test simulator.
2. Open the panel and increment the already-running fixture's counter once.
3. Ask for a screenshot showing that counter value without further interaction.
4. Start scoped native logs, press **Emit test logs**, show the messages, then stop.
5. Record CPU/memory while running the bounded workload; show the saved chart
   and select an interval.

These are the five positive cases in this branch. Keep the three negative cases
as written review cases. No narration or transcript is imposed by this checklist;
make the prompts and results readable. Do not label simulator measurements as FPS.

Use a recording of this version, not footage of newer controls. Omit TraceSift,
storage browsing/clearing, network throttling, clean status bar, app-language
controls, the newer App tab, and Command-V paste. Device discovery, screen
interaction, screenshots, logs and CPU/memory charts remain applicable.
The newer bottom workspace toolbar/layout is also absent.

## Video metadata and validation

Set `extensions.com.openai.review.demo_recording_url` to the revised recording's
public HTTPS URL when it is supplied. It is intentionally absent now; the 0.1.163
recording is not reused. A separately named file or branch URL avoids changing
the other submission's recording. Check reviewer access and playback.

```sh
npm run check:marketplace-review
npm run check:marketplace-review -- --ready
```

The second command must fail until a real recording URL is added. Neither
command executes cases or verifies video contents.

## Differences from 0.1.163

| Capability | 0.1.132 |
| --- | --- |
| Simulator/Android streaming, UI reads, input, screenshots | Present |
| Physical iOS mirroring and supported-device performance | Present, with platform prerequisites |
| Native/Metro logs | Present |
| Saved CPU/memory/FPS recordings, interactive charts and comparisons | Present; simulator Display FPS unsupported |
| TraceSift analysis, Explore and Investigate | Absent |
| App storage inspection, SQLite browsing and clear/reset tools | Absent |
| New App panel and dedicated launch/terminate/language controls | Absent; launch with the fixture script/project tools |
| Network throttling and clean status bar | Absent |
| Named location presets | Absent; manual location settings already exist |
| Command-V paste into the streamed device | Absent; existing text input remains |
| New bottom workspace toolbar | Absent; use the older layout |

The later accessibility/annotation fixes, Android unauthorized-device recovery,
screenshot size bounding and shared physical-device capture fixes are also not
backported. This branch is not equivalent to 0.1.163 with features hidden.
TraceSift annotation and storage-redaction fixes do not apply because those
features are absent. Existing telemetry is unchanged.

## Packaging

Use this branch's build/package scripts and pinned dependencies. The package
allowlist includes only the `mobile-dev` and `mobile-dev-setup` skills.
Do not submit a GitHub source ZIP or import the source root as the release artifact.

The existing `v0.1.132` tag and release remain unchanged. Do not run
`public-release` to overwrite them. A branch package must be distinguished by its
source SHA/checksum; if the portal requires a new version, choose an unused
version before building and keep all version files synchronized.

Sources: [submission metadata](https://developers.openai.com/plugins/deploy/submission#configure-onboarding-review-and-publication),
[plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).
