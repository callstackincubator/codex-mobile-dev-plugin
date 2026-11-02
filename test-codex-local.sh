#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL=0
FULL_CHECK=0
NO_LAUNCH=0

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

if [[ ! -x vendor/baguette/Baguette ]]; then
  npm run vendor:baguette
fi
if [[ ! -f packages/runtimes/agent-device/node_modules/agent-device/package.json ]]; then
  npm run vendor:agent-device
fi
if [[ ! -d packages/runtimes/serve-emu/node_modules ]]; then
  npm run vendor:serve-emu
fi

npm run build
node --test packages/core/test/app-flow-*.test.ts
npm run package
npm run test:codex-plugin

# Fail fast when the bundle misses the tools this worktree adds: Codex runs the
# packaged copy, so a stale or partial build looks like "Tool ... not found".
for tool in mobile_appflow_projects mobile_appflow_choose_project; do
  if ! grep -q "$tool" release/marketplace/plugins/mobile-dev/dist/server.mjs; then
    echo "release bundle is missing $tool; the build did not pick up packages/core/src/app-flow-tools.ts" >&2
    exit 1
  fi
done

if [[ $FULL_CHECK -eq 1 ]]; then
  npm run test:package
fi

MARKETPLACE_ROOT="$ROOT/release/marketplace"
MARKETPLACES_JSON="$(codex plugin marketplace list --json)"
CONFIGURED_ROOT="$(
  printf '%s' "$MARKETPLACES_JSON" |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => { input += chunk; });
      process.stdin.on("end", () => {
        const entry = JSON.parse(input).marketplaces?.find(value => value.name === "mobile-dev-local");
        process.stdout.write(entry?.root ?? "");
      });
    '
)"

if [[ -z "$CONFIGURED_ROOT" ]]; then
  codex plugin marketplace add "$MARKETPLACE_ROOT"
elif [[ "$CONFIGURED_ROOT" != "$MARKETPLACE_ROOT" ]]; then
  # Another worktree (or a stale checkout) owns the marketplace name. Repoint it
  # here, or every later install would update the cache from that other build.
  echo "Repointing mobile-dev-local from $CONFIGURED_ROOT to this worktree."
  codex plugin marketplace remove mobile-dev-local
  codex plugin marketplace add "$MARKETPLACE_ROOT"
fi

codex plugin add mobile-dev@mobile-dev-local --json

APP_NAME="${CODEX_DESKTOP_APP:-Codex}"
VERSION="$(node -p 'require("./package.json").version')"
echo
echo "Mobile Dev $VERSION from this worktree is installed."

if [[ $NO_LAUNCH -eq 1 || ! -t 0 ]]; then
  echo "Fully quit the desktop app, then run:"
  printf 'open -na %q\n' "$APP_NAME"
  exit 0
fi

echo "Fully quit $APP_NAME with Cmd-Q before continuing."
read -r -p "Press Enter to relaunch it... "
open -na "$APP_NAME"

echo "Open a new chat, open Mobile Dev from the sidebar, and try the App Flow project picker."
