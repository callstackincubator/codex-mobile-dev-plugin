#!/bin/sh
set -eu

if [ -z "${SHELL:-}" ]; then
  printf '%s\n' 'Mobile Dev setup failed: the desktop did not provide the configured user shell (SHELL), so Node cannot be discovered.' >&2
  exit 127
fi

if [ -x "$SHELL" ]; then
  :
else
  printf '%s\n' 'Mobile Dev setup failed: the configured user shell is missing or not executable.' >&2
  exit 127
fi

marker=$(printf '\036mobile-dev-node:')
if lookup=$("$SHELL" -ilc 'printf "\036mobile-dev-node:"; command -v node'); then
  case "$lookup" in
    *"$marker"*) node_path=${lookup##*"$marker"} ;;
    *) printf '%s\n' 'Mobile Dev setup failed: the user shell did not return a Node executable.' >&2; exit 127 ;;
  esac
else
  printf '%s\n' 'Mobile Dev setup failed: Node was not found in the configured user login shell. Install Node.js 22.18 or later and make node available in that shell.' >&2
  exit 127
fi

newline='
'
case "$node_path" in
  *"$newline"*) printf '%s\n' 'Mobile Dev setup failed: the user shell returned an ambiguous Node path.' >&2; exit 127 ;;
  /*) ;;
  *) printf '%s\n' 'Mobile Dev setup failed: the user shell resolved node to an alias, function, or relative path. Expose a Node executable on that shell’s PATH.' >&2; exit 127 ;;
esac

if [ -x "$node_path" ]; then
  :
else
  printf '%s\n' 'Mobile Dev setup failed: the Node executable discovered in the user shell is missing or not executable.' >&2
  exit 127
fi

if "$node_path" --eval '
  const parts = process.versions.node.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(`Mobile Dev setup failed: the user shell resolves Node.js ${process.versions.node}; version 22.18 or later is required. Upgrade the Node selected by that shell.`);
    process.exit(1);
  }
'; then
  exec "$node_path" "$@"
else
  printf '%s\n' 'Mobile Dev setup failed: the Node executable discovered in the user shell could not pass its startup check.' >&2
  exit 1
fi
