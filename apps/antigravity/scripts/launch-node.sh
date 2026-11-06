#!/bin/sh
# Runs Mobile Dev with Node.js 22.19 or later.
#   launch-node.sh <script> [args]  runs the script with the first usable Node.
#   launch-node.sh --check          prints a SessionStart hook result when none is found.
# Claude starts plugin servers and hooks with the PATH it was launched with. Opened
# from the Dock, that PATH usually lacks version managers, so also try their usual
# install locations.
set -u

message="Mobile Dev needs Node.js 22.19 or later, and none was found on PATH or in Homebrew, nvm, fnm, Nix, Volta, mise or asdf locations. Install it, for example with 'brew install node' or from https://nodejs.org, then restart Claude."

usable() {
  [ -x "$1" ] && "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' >/dev/null 2>&1
}

candidates() {
  command -v node
  for directory in /opt/homebrew/bin /opt/homebrew/opt/node/bin /opt/homebrew/opt/node@24/bin /opt/homebrew/opt/node@22/bin /usr/local/bin \
    "$HOME/.volta/bin" "$HOME/.local/share/mise/shims" "$HOME/.asdf/shims" \
    "$HOME/.local/share/fnm/aliases/default/bin" "$HOME/Library/Application Support/fnm/aliases/default/bin" \
    "$HOME/.nix-profile/bin" "/etc/profiles/per-user/${USER:-$(id -un)}/bin" /run/current-system/sw/bin /nix/var/nix/profiles/default/bin; do
    echo "$directory/node"
  done
  for path in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/mise/installs/node/*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/Library/Application\ Support/fnm/node-versions/*/installation/bin/node; do
    echo "$path"
  done
}

node=$(candidates 2>/dev/null | while IFS= read -r candidate; do
  if [ -n "$candidate" ] && usable "$candidate"; then echo "$candidate"; break; fi
done)

if [ "${1:-}" = "--check" ]; then
  [ -n "$node" ] && exit 0
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Mobile Dev tools are unavailable: Node.js 22.19 or later was not found. When the user asks for iOS or Android device work, explain this and offer to install Node.js (with Homebrew when brew is available, otherwise from https://nodejs.org), then ask them to fully restart Claude."}}\n' "$message"
  exit 0
fi

if [ -z "$node" ]; then
  echo "$message" >&2
  exit 1
fi
exec "$node" "$@"
