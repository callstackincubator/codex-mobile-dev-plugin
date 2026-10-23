# Mobile Dev skills

Agent skills for the tools every host's server exposes. Each skill is a standard
`SKILL.md` with its references; `agents/openai.yaml` adds Codex's display metadata and
other hosts ignore it. A host's package step includes the skills its host supports:
the Codex plugin ships `mobile-dev` and `mobile-dev-setup`. Claude Desktop's MCPB
bundles have no skill support yet.

`agent-device` belongs to the retained, currently inactive Agent Device server;
`npm run build` regenerates its `references/workflow.md` from the pinned runtime.
