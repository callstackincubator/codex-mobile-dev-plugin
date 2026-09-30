# Packaging and installation

Read [Package your plugin](https://developers.openai.com/plugins/build/plugins) for current paths and host behavior. Check [submission field rules](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information) before preparing a public package.

## Choose the package format

| Part | New portable package | Codex compatibility package |
| --- | --- | --- |
| Manifest | `plugin.json` | `.codex-plugin/plugin.json` |
| Manifest schema | Agent Plugins schema required | Omit the portable `$schema` |
| Skills | Root `skills/`, automatic discovery | Declare `skills: "./skills/"` |
| Bundled MCP | Root `mcp.json`, automatic discovery | Declare `mcpServers: "./.mcp.json"` |
| OpenAI listing fields | `extensions.com.openai.interface` | Root `interface` |
| Registered connections | `extensions.com.openai.apps` | Root `apps` |
| Hook setting | `extensions.com.openai.hooks` | Root `hooks` |
| Onboarding, review, publication | `extensions.com.openai` | `extensions.com.openai` |

Keep a working format for an ordinary edit. For a portable manifest, an inline `extensions.com.openai` object replaces the entire compatibility overlay; the host does not merge them. Portable skills and MCP paths remain fixed even when an overlay tries to declare others.

## Portable starter

Create only the parts the workflow uses:

```text
my-plugin/
  plugin.json
  mcp.json
  skills/
    inspect-items/
      SKILL.md
      agents/openai.yaml
  dist/
    server.js
    app.html
  assets/
    icon.svg
```

A complete local example, after replacing the publisher and adding the referenced icon:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "item-library",
  "version": "0.1.0",
  "description": "Browse and inspect project items.",
  "author": { "name": "Your team" },
  "extensions": {
    "com.openai": {
      "interface": {
        "displayName": "Item Library",
        "shortDescription": "Browse project items",
        "longDescription": "Browse project items and attach a selection to a conversation.",
        "developerName": "Your team",
        "category": "Developer Tools",
        "capabilities": ["Read", "Interactive"],
        "composerIcon": "./assets/icon.svg",
        "logo": "./assets/icon.svg",
        "defaultPrompt": ["Find the items in this project."]
      }
    }
  }
}
```

Root `mcp.json` for a local bundled server:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "item-library": {
      "type": "stdio",
      "command": "node",
      "args": ["./dist/server.js"],
      "cwd": "./"
    }
  }
}
```

For a hosted server, replace the entry with:

```json
{
  "type": "streamable-http",
  "url": "https://your-service.example/mcp"
}
```

The portable [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) requires a transport `type`. Use Streamable HTTP for new remote implementations. The schema also represents legacy SSE, which does not establish support for public submission. Never write tokens into `headers` or `env` in a distributable file. Do not override host-provided `PLUGIN_ROOT` or `PLUGIN_DATA`.

## Compatibility starter

Existing Codex packages and the current Plugin Creator can use:

```json
{
  "name": "item-library",
  "version": "0.1.0",
  "description": "Browse and inspect project items.",
  "author": { "name": "Your team" },
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Item Library",
    "shortDescription": "Browse project items",
    "longDescription": "Browse project items and attach a selection to a conversation.",
    "developerName": "Your team",
    "category": "Developer Tools",
    "capabilities": ["Read", "Interactive"],
    "composerIcon": "./assets/icon.svg",
    "logo": "./assets/icon.svg"
  }
}
```

Save this as `.codex-plugin/plugin.json`. Its `.mcp.json` has an `mcpServers` object with the server's `command`, `args`, and `cwd`, or remote `url`. Preserve the existing host-specific format. A portable conversion needs both a new manifest and MCP transport declarations.

All referenced paths resolve from the plugin root, including paths declared inside `.codex-plugin/`. Start package paths with `./`, keep them within the package, and exclude `..`. Include every referenced asset and runtime file.

## Bundle skills and setup

Use `skills/<name>/SKILL.md` with YAML `name` and `description`. Keep the folder name equal to the skill name. Put shared workflow rules in the entry file and load detailed references only when they apply. Skill UI fields in `agents/openai.yaml` use snake_case; plugin listing fields use camelCase.

When a skill needs the plugin's MCP server, declare that actual dependency in its `agents/openai.yaml` as described in [Build skills](https://developers.openai.com/plugins/build/skills#connect-skills-to-mcp-tools). Avoid inventing a dependency name or URL.

To offer setup after installation, package a real setup skill and add:

```json
{
  "extensions": {
    "com.openai": {
      "onboardingSkill": "./skills/setup/SKILL.md"
    }
  }
}
```

Merge this into the manifest rather than replacing it. Setup should use the normal tools and account connection flow. It must not request credentials in chat or repeat on every ordinary invocation.

## Registered app references

Use `.app.json` only to map an existing registered connection, such as a developer-mode connection with a `plugin_asdk_app...` technical ID. It is distinct from a bundled MCP command or URL.

If Plugin Creator is available, give it the real registered ID and ask it to wire the existing plugin. Inspect the generated mapping and manifest reference. If it is unavailable, read the current registered-app schema or an official example before authoring the mapping. Do not guess its internal fields.

This route helps local testing. Current public ZIP submission rejects `apps` references and `.app.json`; declare the remote server URL in MCP configuration for that route.

## Marketplaces

For repo use, store a catalog at `.agents/plugins/marketplace.json`:

```json
{
  "name": "local-repo",
  "interface": { "displayName": "Project plugins" },
  "plugins": [
    {
      "name": "item-library",
      "source": { "source": "local", "path": "./plugins/item-library" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

`source.path` resolves from the marketplace root, not `.agents/plugins/`. A personal catalog at `~/.agents/plugins/marketplace.json` can point to `./.codex/plugins/item-library` under the home root. Keep other catalog entries intact.

For a Git subdirectory source:

```json
{
  "source": "git-subdir",
  "url": "https://github.com/your-team/plugins.git",
  "path": "./plugins/item-library",
  "ref": "main"
}
```

Use `source: "url"` for a plugin at a Git repository root. Catalogs also support `npm` sources with `package`, optional `version`, and optional HTTPS `registry`; current installation downloads without running package lifecycle scripts. Use the guide for the full source format.

The current CLI exposes:

```sh
codex plugin marketplace list
codex plugin marketplace add ./marketplace-root
```

Inspect `codex plugin --help` on the user's version before giving further commands. For the desktop flow, install from the local source in the Plugins Directory, refresh or restart as the host requires, and use a new chat. The host loads an installed cache copy, so editing that copy is not a source update.

For an authorized project setting, the marketplace key is:

```toml
[plugins."item-library@local-repo"]
enabled = true
```

Project config requires a trusted project. Discoverability, enabled state, installation, and service authentication are separate. Workspace-managed plugins follow their workspace policy.

## Hooks and runtime packaging

Add hooks only for a task that needs lifecycle behavior. Use `extensions.com.openai.hooks` in a portable manifest or root `hooks` in a compatibility manifest. Otherwise the host can discover `hooks/hooks.json`. An explicit hook field replaces that discovery.

Hook commands receive `PLUGIN_ROOT` and writable `PLUGIN_DATA`. The compatibility `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` variables also exist. Installing a package does not trust its hooks, and a web install does not deploy scripts to an execution machine. Read the [hook guide](https://learn.chatgpt.com/docs/hooks) for the event schema and trust process. Current public ZIP submission rejects hooks.

Build distributable code before sharing. Keep the executable dependencies available on the execution host or bundle them where the runtime allows. Do not depend on a developer's absolute path, unshipped `node_modules`, a source checkout, or an automatic install step. For stdio, write logs to stderr so stdout remains MCP traffic.
