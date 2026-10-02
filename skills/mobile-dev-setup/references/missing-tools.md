# Recover missing Mobile Dev tools

Use this when the installed plugin's device tools are unavailable. Diagnose and
explain the setup problem in chat, then offer the concrete repair. The user should
not need to understand MCP or search desktop logs themselves.

## Check the installed launcher first

Find the installed plugin root from the absolute path of the loaded `SKILL.md`:
the skill is under `<plugin-root>/skills/<skill-name>/SKILL.md`. Verify its
`.mcp.json` and `scripts/launch-mcp.sh`; use that installed copy, not a source
checkout, a guessed cache version, or a hardcoded username. Set `plugin_dir` to
that verified absolute root and run this read-only check with a 30-second limit:

```sh
(
  cd "$plugin_dir" &&
  /bin/sh ./scripts/launch-mcp.sh --version
)
```

Capture the exit status, stdout, and stderr. This uses the same login-shell Node
lookup and minimum-version check as MCP startup, without starting the server or
touching devices. The agent's environment can differ from the desktop's; a
successful check does not prove the desktop process started.

- **Unsupported Node:** State the detected version and required minimum. For
  example: "Mobile Dev cannot start because your shell selects Node 22.14.0.
  It needs Node 22.18 or newer. I can help update the Node installation your
  shell uses."
- **Missing Node or unusable executable:** Explain the reported setup failure
  and offer to repair the user's Node installation.
- **Missing shell, ambiguous lookup, or check timeout:** Diagnose that specific
  shell/environment problem. A timeout does not establish a Node version or
  prove that the MCP startup timeout is too short.
- **Check succeeds:** Inspect plugin enablement, the installed MCP configuration,
  and recent Mobile Dev startup/discovery events. Report the actual failure or
  state what remains unknown; do not claim an unsupported Node caused a timeout
  merely because it was found in another environment.

Read only the relevant configuration and recent desktop log files. Do not search
all of `~/.codex` or `~/Library/Logs`. Older packages through 0.1.106 used bare
`node` on desktop PATH; inspect their actual launch configuration instead of
assuming they have this launcher. Recommend increasing a timeout only when
evidence shows healthy startup exceeds it and prerequisite checks pass.

## Offer and verify a repair

For missing or unsupported Node, inspect the configured login shell's resolved
Node executable and existing manager configuration with bounded read-only checks.
Confirm whether the installation is managed by Nix, nvm, Homebrew, or another
manager; a path alone does not establish how it is configured. Prepare an upgrade
or selection change through that same manager. Explain the selected version and
which user or project configuration would change, and ask for approval unless
the user already explicitly authorized that change. An app build request alone
does not authorize changing the user's global Node default, shell configuration,
or project version pins. Do not silently add another Node installation or switch
managers. If no manager exists, ask which installation method the user prefers.

After an authorized repair, rerun the installed launcher check. If it passes but
the desktop's tools remain unavailable, ask the user to fully quit and reopen
Codex and start a new chat so it can rediscover the server and tools. Do not close
the user's running chats yourself. Confirm tool discovery and connectivity before
claiming the panel is restored or resuming device work. Preserve the original app
task and explain what remains blocked if the user declines the repair.

Keep diagnostics local. Launcher failures happen before the plugin's Sentry SDK
starts; these checks do not upload shell output, local paths, or host logs.
