# Testing, troubleshooting, and release

Use [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) for developer-mode testing and [Submit your plugin](https://developers.openai.com/plugins/deploy/submission) for a public release. Keep evidence from the actual installed package.

## Check the target host

The extension [platform table](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#platform-support) describes expected launch support. Its web column means the Work browser, excluding classic ChatGPT. Recheck it for the host and account in the current task.

| Feature | Desktop | Work web | iOS | Android |
| --- | --- | --- | --- | --- |
| Global and thread entrypoints | Yes | Yes | Yes | Yes |
| File entrypoint | Yes | No | No | No |
| Structured settings | Yes | Yes | Yes | Yes |
| Inline and fullscreen | Yes | Yes | Yes | Yes |
| Deep links | Yes | Yes | Yes | No |
| Message extensions | Yes | Yes | Active send only | Active send only |
| Onboarding | Yes | Yes | Yes | Yes |
| Model context | Yes | Yes | No text thumbnails | Yes |
| Local file opening and resources | Yes | No | No | No |
| Composer item mentions | Yes | No | No | No |
| OpenAI rich forms | Yes | Yes | No | No |

Message resource links also have an iOS limit. Web resource forms requested through MCP Apps allow explicit selection without uploads. The CLI may load a plugin's tools and skills while offering no graphical extension. Custom settings entrypoints and SDK-only additions need their own host check.

Use negotiated capabilities to hide or disable unsupported UI actions. Do not confuse public listing availability with feature availability. The [extension guide](https://developers.openai.com/plugins/build/extensions) also notes plan rollout limits.

## Check the package before host testing

Respect the user's and repository's check rules. Do not start another development server when this project already has one. Inspect build scripts before running them; they may invoke type checks or lint.

For a documentation or manifest edit, parse the changed JSON or YAML and check referenced paths. For a server or editor change, use permitted contract tests for changed behavior. Run visual or browser checks only when the task and local rules allow them.

Verify the installable folder rather than relying on the source checkout:

- Its manifest matches the chosen schema and format.
- Every referenced skill, resource, icon, hook script, and executable exists.
- Runtime paths resolve from the installed plugin root.
- MCP stdout contains only protocol traffic for stdio servers.
- Bundled HTML includes its dependencies and allowed asset origins.
- No credentials, developer paths, caches, or unneeded source data enter the distributable package.

Copy the build to a temporary directory and test from that location when permitted. This catches missing files and hidden dependencies on the development checkout.

## Inspect the server

For a server change, use an existing project test tool or MCP Inspector if permitted:

```sh
npx @modelcontextprotocol/inspector@latest
```

Inspect initialization or discovery, tool schemas, resource reads, structured results, errors, and account access. Exercise the actual changes with valid inputs, invalid inputs, empty results, and unauthorized resources. Do not claim an Inspector test proves native entrypoints work.

For remote developer-mode testing, use a public HTTPS endpoint or supported private MCP tunnel. Enable developer mode under ChatGPT Settings > Security and login when the account permits it, then connect through the Plugins page. Complete OAuth if required.

After metadata or UI resource changes, restart or deploy the server, refresh the developer-mode connection, and use a new chat. For package edits, refresh or reinstall the local source as the host requires. Editing a source folder alone does not prove the installed cache changed.

## Test the installed workflow

Choose cases that show the changed behavior rather than tests that repeat implementation wording:

| Area | Useful case |
| --- | --- |
| Skill discovery | Direct request, different wording with the same goal, unrelated request |
| Tool sequence | Find a record, use its returned ID, complete a follow-up |
| Entry initialization | Open global and thread apps with `{}` and render the first result once |
| Conversation isolation | Open two thread panels and confirm they keep independent temporary state |
| Unsupported host | Complete the core tool workflow with the absent UI action disabled |
| Settings | Patch one field, keep the rest, reload saved values for the same account |
| Files | Read, external update, read-only save attempt, ETag conflict, oversized write |
| Context | Attach a selection, remove it in the composer, remount without restoring removed content |
| Forms | Accept, decline, cancel, invalid input, unsupported field, appropriate MRTR flow |
| Mentions | Empty query, no match, limited results, wrong-account data absent |
| Auth | Expired token, scope upgrade, account switch, denied record access |

Record what ran, the host version, tool arguments, result, and failure. Where access or local rules prevent a check, name the untested behavior and provide a short reproduction path.

## Troubleshoot the correct component

| Symptom | First checks |
| --- | --- |
| Local plugin missing | Catalog root and path, manifest name, trust, host refresh, installed source |
| Change does not appear | Source versus installed cache, package version, connection refresh, UI URI |
| Tools missing | Transport process or `/mcp`, initialization or discovery, auth, schemas |
| Sidebar or thread app missing | Tool entrypoint metadata, installed plugin state, supported host |
| Tool returns data but no UI | Exact `ui.resourceUri`, registered resource, MCP Apps MIME type, bundled HTML |
| Initial app is blank or flickers | Handlers attached before `connect()`, initial tool result, duplicate opening call |
| Extension API is absent | Call after connection, negotiated host capability, platform support |
| UI assets fail | CSP origins, resource paths, bundle dependencies, versioned resource URI |
| File handler fails | Dot-prefixed extension, initial `file` arguments, opaque URI, host resource API |
| Save loses edits | `writable` metadata, current ETag, conflict branch, dirty draft on subscription update |
| Settings reset | Durable server storage, account identity, merged patch, all effective values returned |
| Mention picker is empty | Desktop support, mention metadata and app visibility, query handler, authorized resources |
| Registered-server forms fail | Protocol version, MRTR support, legacy helper use, supported field types |
| OAuth repeats or returns `401` | Protected-resource discovery, challenge, issuer, audience, scopes, PKCE, redirect URI |
| `invalid_client` on an old link | Reused registered client and secret still valid, separate from token expiry |
| Streaming breaks | Proxy buffering, HTTP transport/session lifecycle, timeouts |
| Hook never runs | Current definition trusted, runtime script present, event schema, effective hook setting |

Use redacted protocol logs and the [troubleshooting guide](https://developers.openai.com/plugins/deploy/troubleshooting). Avoid changing several components at once. Fix the failed contract, then repeat the affected check.

## Prepare a public ZIP

Check current [submission rules](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information). The guide at the skill's check date starts with a plugin ZIP, then connects its declared server in the dashboard.

Prepare a public package distinct from local-only wiring when needed:

- Include the remote MCP URL in the initial package. The current portal cannot add MCP to an existing skills-only plugin.
- Remove registered `apps` references, `.app.json`, and lifecycle hooks from the public package. The current ZIP route rejects them.
- Use a stable public HTTPS MCP endpoint. A local command or development tunnel is not sufficient.
- A package can declare multiple servers, but the current portal connects only one server per plugin.
- Package bundled skills or implement server skill import. Check the imported snapshot before submitting.
- Include all assets, built resources, and real listing details. Keep credentials outside the ZIP.

Keep the chosen manifest at the package root inside the ZIP, preserve dotfiles needed by compatibility packages, and exclude enclosing checkout directories, `.git`, OS metadata, and temporary files. List archive members and compare them with the manifest paths before upload.

### Listing and assets

Current public limits include:

| Field or asset | Limit |
| --- | --- |
| Plugin `name` | At most 64 characters, lowercase letters, digits, single hyphens |
| `displayName`, `shortDescription` | At most 30 characters each |
| `longDescription` | At most 4000 characters |
| `developerName` | At most 80 characters |
| Starter prompts | Up to 3, at most 128 characters each, omit app @mentions |
| Each supported image | At most 5 MiB |
| Icons and logos | Square, at least 48 by 48; raster dimensions at most 4096 |

Use the submission guide's exact fields for the chosen format. MCP review requires HTTPS product, support, privacy, and terms URLs in the listing fields. `homepage` and `author.url` do not fill them. A 20 by 20 entrypoint tool icon follows a different guideline from the directory icon.

### Review materials

For initial MCP review, prepare exactly five positive and three negative cases, run them against a dedicated reviewer account, and provide an accessible demo recording. Record expected tools and observable results. Put optional `review` and `publication` metadata directly under `extensions.com.openai`, outside `interface`.

Enter reviewer credentials and sign-in instructions in the secure dashboard. The ZIP rejects `test_credentials` and `reviewer_instructions`. Skills-only plugins do not need MCP review cases or a demo recording.

## Submission and updates

Follow the current [portal instructions](https://developers.openai.com/plugins/deploy/submission). Submission needs an organization owner or Apps Management Write and the intended verified developer identity. Do the work the user authorized; a request to build a package alone is not a request to submit or publish it.

For an authorized submission, upload the prepared ZIP, resolve metadata and skill checks, connect the declared server, complete domain verification and authentication, and review the discovered tools. Domain verification expects the exact plain-text token at the portal's `/.well-known/openai-apps-challenge` URL. Do not overwrite another plugin's token.

Submit the selected draft only after required checks and review information are complete. Public publication is a separate step after approval. Only one review can be active for a plugin.

For updates, metadata, skills, assets, or MCP configuration need a new ZIP and applicable review. Hosted tool changes follow the current MCP scan and continuous review process; passing eligible changes can go live without a new ZIP. Imported skill changes still need a new snapshot and package release. Report each state with evidence rather than treating deployment, scan, approval, and publication as equivalent.
