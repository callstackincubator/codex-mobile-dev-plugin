# Marketplace review package

The canonical five positive and three negative cases, expected tools/results, and
release notes are in `apps/codex-plugin/.codex-plugin/plugin.json` under `extensions.com.openai`.
These are **test specifications**, not claims that the final submission passed.
Run them against the exact ZIP to be submitted, in fresh chats where indicated.

The submitting organization has confirmed its desktop/local-MCP submission route
and allowlisting. This package contains one local MCP server, not a remote OAuth
service. No Mobile Dev account or test credentials are required.

## Reproduce the setup

1. Use an Apple Silicon Mac, Codex desktop with plugin access, Xcode 26+ selected
   with an installed iOS 18+ simulator, and the submitted Mobile Dev ZIP. Check
   `uname -m`, `xcodebuild -version`, and `xcode-select -p`. Android cases require
   Android SDK platform-tools/emulator and an AVD or authorized development device.
   A missing Android SDK should produce an actionable explanation, not a fake list.
2. Install the **submitted ZIP** through the confirmed organization's local-MCP
   upload/install route. Open a fresh chat and run the Mobile Dev setup skill.
   The package includes its native helpers and uses Codex's Node runtime; it does
   not require a separate Baguette install or hosted endpoint.
3. Clone this public repository and check out the source commit recorded with that
   submission. Record the full SHA and ZIP checksum in the evidence table below.
   Source builds, if needed, require the additional pinned native toolchains and
   commands in [CONTRIBUTING.md](../../CONTRIBUTING.md#build-and-package).
4. Ask Mobile Dev to list devices. Open its panel, select one compatible simulator,
   and boot it if stopped. Use its actual UDID throughout; do not use `booted` when
   multiple simulators exist. From the repo root run:

   ```sh
   ./examples/ios-test-app/run.sh <selected-simulator-UDID>
   ```

   This builds, installs and launches the dependency-free SwiftUI fixture
   `dev.mobile.testapp`. See its [README](../../examples/ios-test-app/README.md).
   Start on the Interact tab with counter zero. The Diagnostics tab has
   **Emit test logs**, the bounded CPU workload, and memory controls. No real user
   accounts, production credentials, or personal app data are needed.
5. For positive case 5, install the TraceSift CLI supporting the plugin's
   `/api/integration/v1` integration and confirm `tracesift --version`. Record
   that exact version in the evidence table; a missing/incompatible CLI is a setup
   failure, not a passing profile result. The plugin invokes `tracesift` from PATH
   or `TRACE_SIFT_COMMAND` and uses `TRACE_SIFT_HOME` (default `~/.tracesift`).
   Generate a synthetic V8 CPU profile from the repo root with Node 22.19+:

   ```sh
   mkdir -p .build/review
   node --cpu-prof --cpu-prof-dir=.build/review --cpu-prof-name=review.cpuprofile docs/review/profile-workload.mjs
   ```

   Substitute its absolute path in the manifest's prompt. Never attach a real
   customer's profile. Open Explore/Investigate only at the specified user steps.
6. Run the five positive cases in order. For logs, start collection before pressing
   **Emit test logs**. For CPU, start the recording before running the five-second
   workload. Use separate fresh chats for the three negative cases. Record actual
   outcomes, including missing prerequisites. Pass/fail is based on observable
   tool calls and UI results, not the assistant saying it succeeded.
7. End the test log/CPU sessions. Stop fixture work with **Stop and release**.
   Remove only test-generated profile/recording artifacts if cleanup is desired;
   uninstalling Mobile Dev does not delete saved recordings or TraceSift results.

## Demo recording

Validate the submission metadata with:

```sh
npm run check:marketplace-review -- --ready
```

Check the link in a signed-out browser (or provide reviewer access through the
secure dashboard) and confirm audio/video playback. Do not put access credentials
or `reviewer_instructions` into the manifest. The check validates metadata only;
it cannot confirm video contents, reviewer access, or execution outcomes.

### What the video must show

OpenAI asks for a reviewer-accessible walkthrough. The following is this project's
recommended coverage so reviewers can reproduce its actual capabilities:

- Start with the installed version and review environment, then show Mobile Dev
  opening beside the chat and listing/selecting the same test simulator.
- Run the fixture, increment the counter, and show the resulting screenshot or
  accessibility output. Keep the tool activity and visible app response in frame.
- Start scoped native logs, press **Emit test logs**, show those messages arriving,
  and close collection.
- Record CPU/memory while the fixture runs its bounded workload. Show the saved
  interactive chart and one interval selection. Do not claim simulator FPS.
- Analyze the synthetic CPU profile, show actual findings, open Explore, then
  select Investigate to demonstrate the explicit handoff. Show that source code
  is not changed merely by analyzing a profile.
- Briefly show the out-of-scope web request, unsupported simulator FPS request,
  and inspect-without-clearing request, with no prohibited tool action.
- For the final stack's storage fix, show a synthetic `password`/`access_token`
  entry and a SQLite credential column returning `[REDACTED]` in both tool output
  and the panel. Show an unrelated store is excluded from a scoped request.
- Show the repository's Privacy, Terms and Support links. Explain local artifacts,
  host-bound results and the telemetry opt-out without claiming all data stays local.

Use synthetic data and crop unrelated chats, notifications and account details.
A few minutes is a practical target, not an official duration requirement. If the
existing video predates a fix, add a short supplemental segment and link it from
the same reviewer-accessible location. A script or automated test log is not a
substitute for the walkthrough recording.

## Final verification

Install the exact ZIP being submitted and run all eight cases. Record the build
version, source commit, ZIP checksum, test environment, TraceSift CLI version,
and actual case outcomes in the release PR. Keep outstanding work in the PR.

Verify the public Website, Privacy, Terms and Support URLs, then build/package
the production artifact and run the package smoke checks. Release notes must
match the contents of that ZIP. Re-upload to change imported cases; the dashboard
makes imported cases read-only.

Sources: [submission metadata](https://developers.openai.com/plugins/deploy/submission#configure-onboarding-review-and-publication),
[plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines),
[desktop-only submission](https://developers.openai.com/plugins/deploy/desktop-only).
