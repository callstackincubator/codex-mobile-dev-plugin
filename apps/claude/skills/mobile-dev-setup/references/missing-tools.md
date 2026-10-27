# Recover missing Mobile Dev tools

Use this when the installed plugin's device tools are unavailable. Diagnose and
explain the setup problem in chat using the actual startup failure.

Find the installed plugin root from the absolute path of the loaded `SKILL.md`:
the skill is under `<plugin-root>/skills/<skill-name>/SKILL.md`. Inspect its
`.claude-plugin/plugin.json` and whether the plugin is enabled. Use that installed
copy rather than a source checkout or guessed cache version. In Claude Code,
`claude mcp list` and `/mcp` show the `mobile-dev` server's status.

The server starts through `scripts/launch-node.sh`, which needs Node.js 22.19 or
later. Run `/bin/sh "<plugin-root>/scripts/launch-node.sh" -p process.version` to
see which Node it finds. If it reports that none was found, explain that Mobile
Dev needs Node.js 22.19 or later and offer to install it: with
`brew install node` when `brew` is available, otherwise point the user to
https://nodejs.org. Do not install it without the user's agreement. After the
install, check the launcher again.

Report the actual failure or state what remains unknown. A generic timeout does
not justify increasing the timeout. Keep diagnostics local; startup failures
occur before the server's Sentry SDK starts.

After resolving the startup failure, confirm tool discovery and connectivity
before resuming device work. If the tools remain unavailable, ask the user to
fully quit and restart Claude and start a new session so it can rediscover the
server. Preserve the original app task and explain what remains blocked.
