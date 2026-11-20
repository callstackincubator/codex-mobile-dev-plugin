# Annotation edit benchmark

Measures how fast and how correctly Codex applies screen annotations, comparing the annotation
formatter and Mobile Dev skill at a git ref ("before") with the working tree ("after"). Each run
gets the same message the panel would send, built by the real formatter from a fixture screen.

```bash
node tooling/annotation-eval/run.ts --before-ref main --runs 3
node tooling/annotation-eval/summarize.ts "$TMPDIR/mobile-dev-annotation-eval/results.json"
```

`--codex-home` defaults to `~/.codex`. Only its auth and top-level settings (model, reasoning
effort, provider) are copied into one CODEX_HOME per version, so your own MCP servers and plugins
do not take part. Skills under `~/.agents/skills` still load and can add time to both versions.

## Scenarios

| | Notes | Expected edit |
|---|---|---|
| A | 1 note on a unique button label | that label only |
| B | 3 notes on every card title, same edit | one change at the shared source |
| C | 3 notes on three components | three edits |
| D | 1 note on card 2 of 3 | that card only |
| E | 1 "remove this" on a header badge | badge gone, header kept |
| F | A without a source location | as A |
| G | C without source locations | as C |

`grade.ts` checks each run's diff. It accepts style edits and call-site props alike and reports
which one the agent chose.

## Device mode

`--device <UDID> --app <dir> --plugin <built plugin>` adds the plugin's MCP server and each
version's skills, and runs one at a time against an app on the simulator. Prepare the app once:

1. Create an Expo app (`npx create-expo-app@latest --template blank-typescript`), copy
   `fixture/App.tsx` and `fixture/src` into it, run `npx expo lint` once so lint is set up, and
   commit. The runner refuses a checkout with uncommitted changes, since it restores the app
   between runs.
2. Use a simulator without a signed-in Apple Account (for example a new one from
   `xcrun simctl create`), install Expo Go and open the app.
3. Start Metro in watch mode. `CI=1` disables Fast Refresh, and `expo start` exits when stdin
   closes, so run `tail -f /dev/null | npx expo start`.
