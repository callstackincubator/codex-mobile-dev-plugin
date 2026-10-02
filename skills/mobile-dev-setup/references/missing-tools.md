# Recover missing Mobile Dev tools

Use this when the installed plugin's device tools are unavailable. Diagnose and
explain the setup problem in chat using the actual startup failure.

Find the installed plugin root from the absolute path of the loaded `SKILL.md`:
the skill is under `<plugin-root>/skills/<skill-name>/SKILL.md`. Inspect its
`.mcp.json`, plugin enablement, and recent Mobile Dev startup/discovery events.
Use that installed copy rather than a source checkout or guessed cache version.
Read only relevant configuration and recent desktop log files; do not search all
of `~/.codex` or `~/Library/Logs`.

The launcher directly uses Codex's bundled Node from its workspace dependency
cache. If startup reports a missing runtime, inspect Codex's dependency setup.
Report the actual failure or state what remains unknown. A generic timeout does
not justify increasing the timeout. Keep diagnostics local; startup failures
occur before the server's Sentry SDK starts.

After resolving the startup failure, confirm tool discovery and connectivity
before resuming device work. If the tools remain unavailable, ask the user to
fully quit and reopen Codex and start a new chat so it can rediscover the server.
Do not close the user's running chats yourself. Preserve the original app task
and explain what remains blocked.
