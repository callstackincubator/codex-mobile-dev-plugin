#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL=0
FULL_CHECK=0
NO_LAUNCH=0

# Run scripts/test-codex-local.sh in the perf-ai checkout first. It serves that tree's
# app and CLI and leaves two pointer files in $TMPDIR (tracesift-codex-test-home and
# tracesift-codex-test-cli). This script reads them and launches the desktop app binary
# directly with TRACE_SIFT_HOME and TRACE_SIFT_COMMAND set, because `open` drops the
# environment. Without the pointer files the app launches via `open -na` and uses the
# default ~/.tracesift home and the `tracesift` on PATH.
usage() {
  echo "Usage: $0 [--install] [--full] [--no-launch]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=1 ;;
    --full) FULL_CHECK=1 ;;
    --no-launch) NO_LAUNCH=1 ;;
    *) usage; exit 2 ;;
  esac
  shift
done

cd "$ROOT"

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    console.error(`Node.js 22.19.0 or newer is required; found ${process.version}.`);
    process.exit(1);
  }
'

if [[ $INSTALL -eq 1 || ! -d node_modules ]]; then
  npm ci
fi

if [[ ! -x packages/native/vendor/baguette/Baguette ]]; then
  npm run vendor:baguette
fi
if [[ ! -f packages/runtimes/agent-device/node_modules/agent-device/package.json ]]; then
  npm run vendor:agent-device
fi
if [[ ! -d packages/runtimes/serve-emu/node_modules ]]; then
  npm run vendor:serve-emu
fi

npm run build
node --test \
  packages/core/test/app-intelligence.test.ts \
  packages/core/test/browser-panel.test.ts \
  packages/core/test/plugin.test.ts \
  packages/core/test/telemetry.test.ts
npm run package
npm run test:codex-plugin

# Codex runs the packaged copy, so catch a stale bundle before installing it.
for tool in mobile_generate_app_intel mobile_app_intel mobile_open_app_intel; do
  if ! grep -q "$tool" release/marketplace/plugins/mobile-dev/dist/server.mjs; then
    echo "release bundle is missing $tool; the build did not include App Intelligence" >&2
    exit 1
  fi
done

if [[ ! -f release/marketplace/plugins/mobile-dev/dist/app-intelligence-worker.mjs ]]; then
  echo "release bundle is missing the App Intelligence worker" >&2
  exit 1
fi

if [[ $FULL_CHECK -eq 1 ]]; then
  npm run test:package
fi

MARKETPLACE_ROOT="$ROOT/release/marketplace"
# `marketplace list` loads every registered marketplace, so it exits non-zero
# and prints no JSON when one of them points at a directory that has gone — a
# worktree deleted since its last run, say. That is the exact case the
# repointing below exists to handle, so neither the listing nor parsing it may
# be fatal; an unreadable registration is simply one we have to replace.
MARKETPLACES_JSON="$(codex plugin marketplace list --json 2>/dev/null || true)"
CONFIGURED_ROOT="$(
  printf '%s' "$MARKETPLACES_JSON" |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const entry = JSON.parse(input).marketplaces?.find(value => value.name === "mobile-dev-local");
          process.stdout.write(entry?.root ?? "");
        } catch {
          process.stdout.write("");
        }
      });
    ' || true
)"

if [[ "$CONFIGURED_ROOT" == "$MARKETPLACE_ROOT" ]]; then
  : # Already pointed here.
else
  if [[ -n "$CONFIGURED_ROOT" ]]; then
    echo "Repointing mobile-dev-local from $CONFIGURED_ROOT to this worktree."
  elif [[ -n "$MARKETPLACES_JSON" ]]; then
    echo "Registering mobile-dev-local at this worktree."
  else
    echo "Could not read the installed marketplaces; re-registering mobile-dev-local at this worktree." >&2
  fi
  # `add` refuses to replace a registration, and a broken one still counts, so
  # clear it first. Removing one that was never there is not an error worth
  # stopping for.
  codex plugin marketplace remove mobile-dev-local >/dev/null 2>&1 || true
  codex plugin marketplace add "$MARKETPLACE_ROOT"
fi

codex plugin add mobile-dev@mobile-dev-local --json

if [[ -n "${CODEX_DESKTOP_APP:-}" ]]; then
  APP_NAME="$CODEX_DESKTOP_APP"
elif [[ -d /Applications/Codex.app ]]; then
  APP_NAME="Codex"
else
  APP_NAME="ChatGPT"
fi
VERSION="$(node -p 'require("./package.json").version')"
echo
echo "Mobile Dev $VERSION from this App Intelligence worktree is installed."

# Pick up a TraceSift working tree served by perf-ai/scripts/test-codex-local.sh.
TS_HOME_FILE="${TMPDIR%/}/tracesift-codex-test-home"
TS_CLI_FILE="${TMPDIR%/}/tracesift-codex-test-cli"
TS_HOME=""
TS_CLI=""
if [[ -f "$TS_HOME_FILE" && -f "$TS_CLI_FILE" ]]; then
  TS_HOME="$(cat "$TS_HOME_FILE")"
  TS_CLI="$(cat "$TS_CLI_FILE")"
  if [[ ! -f "$TS_HOME/service.json" || ! -x "$TS_CLI" ]]; then
    echo "Ignoring stale TraceSift pointer files (perf-ai/scripts/test-codex-local.sh is no longer running)." >&2
    TS_HOME=""
    TS_CLI=""
  fi
fi

APP_BIN=""
if [[ -n "$TS_HOME" ]]; then
  APP_PLIST="/Applications/$APP_NAME.app/Contents/Info.plist"
  EXEC_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PLIST" 2>/dev/null || true)"
  if [[ -n "$EXEC_NAME" && -x "/Applications/$APP_NAME.app/Contents/MacOS/$EXEC_NAME" ]]; then
    APP_BIN="/Applications/$APP_NAME.app/Contents/MacOS/$EXEC_NAME"
  else
    echo "Could not find the $APP_NAME binary under /Applications; falling back to open -na without TraceSift variables." >&2
    TS_HOME=""
  fi
fi

launch_command() {
  if [[ -n "$APP_BIN" ]]; then
    printf 'TRACE_SIFT_COMMAND=%q TRACE_SIFT_HOME=%q %q' "$TS_CLI" "$TS_HOME" "$APP_BIN"
  else
    printf 'open -na %q' "$APP_NAME"
  fi
}

if [[ -n "$APP_BIN" ]]; then
  echo "TraceSift: using the working tree. home=$TS_HOME cli=$TS_CLI"
else
  echo "TraceSift: no working-tree pointer files; the panel will use ~/.tracesift and the tracesift on PATH."
fi

if [[ $NO_LAUNCH -eq 1 || ! -t 0 ]]; then
  echo "Fully quit the desktop app, then run:"
  echo "$(launch_command)"
  exit 0
fi

echo "Fully quit $APP_NAME with Cmd-Q before continuing."
read -r -p "Press Enter to relaunch it... "
if [[ -n "$APP_BIN" ]]; then
  TRACE_SIFT_COMMAND="$TS_CLI" TRACE_SIFT_HOME="$TS_HOME" nohup "$APP_BIN" >/dev/null 2>&1 &
  disown
else
  open -na "$APP_NAME"
fi

echo "Open a new chat, open Mobile Dev, choose App Intelligence from the feature menu, select a React Native project, and generate its graph."
echo "In chat, also try: Show me the App Intelligence for this app."
echo "Then ask: What are the dependencies of <screen name>?"
