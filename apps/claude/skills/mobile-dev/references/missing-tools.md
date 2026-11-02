# Recover missing Mobile Dev tools

Use this when the installed plugin's tools are unavailable. Diagnose and explain the
setup problem in chat from the actual startup failure.

Find the installed plugin root from the absolute path of the loaded `SKILL.md`: the
skill is under `<plugin-root>/skills/mobile-dev/SKILL.md`. Inspect its
`.claude-plugin/plugin.json` and whether the plugin is enabled. Use that installed
copy rather than a source checkout or a guessed cache version. In Claude Code,
`claude mcp list` and `/mcp` show the `mobile-dev` server's status.

The server starts through `scripts/launch-node.sh`, which needs Node.js 22.19 or
later and looks for it on `PATH` and in the usual Homebrew, nvm, fnm, Nix, Volta, mise and
asdf locations. Run `/bin/sh "<plugin-root>/scripts/launch-node.sh" -p process.version`
to see which Node it finds. If it reports that none was found, explain that Mobile
Dev needs Node.js 22.19 or later and offer to install it: with `brew install node`
when `brew` is available, otherwise from https://nodejs.org. Do not install it
without the user's agreement. After the install, check the launcher again.

Report the actual failure, or say what remains unknown. A generic timeout does not
justify increasing the timeout. Keep diagnostics local; startup failures occur before
the server's Sentry SDK starts.

After resolving the startup failure, ask the user to fully quit and restart Claude
and start a new session so it can rediscover the server, then confirm the tools are
available before resuming device work. Keep the original app task, and explain what
remains blocked.
