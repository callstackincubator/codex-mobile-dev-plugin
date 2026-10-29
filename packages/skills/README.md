# Mobile Dev skills

Agent skills for the tools every host's server exposes. Each skill is a standard
`SKILL.md` with its references; `agents/openai.yaml` adds Codex's display metadata,
which other hosts' packages leave out. A host's package step includes the skills its host supports:
the Codex and Cursor plugins ship `mobile-dev`, `mobile-dev-setup` and `agent-device`.
The Claude Code plugin ships its own `mobile-dev` skill from `apps/claude/skills`, for
its server without the panel, and the shared `agent-device` skill; Claude Desktop's
MCPB bundles have no skill support yet.

`agent-device/references/workflow.md` is the pinned agent-device runtime's own
`help workflow`. `npm run catalog:agent-device` rewrites it with the tool catalog, and a
unit test checks it against the runtime.
