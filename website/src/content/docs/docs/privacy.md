---
title: Privacy Policy
description: Read how Mobile Dev processes local development data, shares results with your host, collects diagnostics, and provides privacy controls.
---

Last updated: 23 October 2026

## 1. Who we are and what this policy covers

Mobile Dev is provided by **Callstack.io spółka z ograniczoną odpowiedzialnością**
("Callstack", "we", "us"), ul. Prosta 36, 53-508 Wrocław, Poland, registered in
the National Court Register maintained by the District Court for Wrocław-Fabryczna
in Wrocław, VI Commercial Division, KRS 0000606530, NIP 8992785616,
REGON 363921820. Contact us at [hello@callstack.com](mailto:hello@callstack.com)
or at that postal address.

This policy covers the Mobile Dev desktop plugin, its bundled local tools,
diagnostics, and support. Callstack is the controller of the personal data it
receives for diagnostics and support. Running a local tool does not by itself
give Callstack access to your project or device. You or your organization remain
responsible for deciding which app and device data to process and share.

The [Callstack website policy](https://www.callstack.com/documents/privacy-policy)
covers our corporate website. OpenAI and other host providers handle information
they receive under their own terms, privacy policies, and your account settings.

## 2. Information processed by Mobile Dev

### Local development workflows and results sent to the host

Depending on the tools you use, Mobile Dev processes:

- Device names, identifiers, operating-system details, installed/running app
  information, process identifiers, and app/project paths needed to select and
  operate your development environment.
- Screen streams, screenshots, accessibility and UI trees, React Native
  component/source details, annotations, and text or clipboard content that you
  choose to enter into a device.
- Native and Metro logs, including messages, timestamps, app/process metadata,
  and stack traces.
- App CPU, memory, thread, FPS, and frame-timing measurements and saved recordings.
- App storage keys, values, database rows, and file metadata when you inspect
  storage. Results are filtered before reaching the host or panel: recognized
  sensitive fields, credential-like values, and binary values are redacted. These
  rules cannot identify every secret or personal detail. Clear/reset operations
  can delete data in the selected app.
- CPU and React profiles, call trees, component names, source paths, analysis
  results, and investigation context when you use TraceSift. The integration
  sends profiles to a TraceSift service on your own computer and saves analysis
  references locally. Choosing a profile or a project folder in the TraceSift
  panel opens your operating system's own dialog; the path you pick is used to
  read that profile and to tell the chat which code a finding belongs to, and the
  project folder is saved locally until you choose another.
- Network requests passing through the local proxy when you enable network
  throttling. That proxy forwards traffic to the destinations requested by your
  app; it is not a Callstack-hosted traffic collection service.

The tools run on your computer and communicate with your selected devices and
development services. Data returned by MCP tools, rendered in the host, or
attached/sent to chat is made available to the host application. Consequently,
"local execution" does not mean everything stays on your computer: host/model
processing depends on the workflow and host configuration. Screenshots, logs,
storage values, and profiles may contain personal or confidential information.
Use test data, scope requests to the relevant app, and review content before
sharing it. Do not provide passwords, API keys, payment-card data, health records,
or government identifiers through these workflows.

Mobile Dev does not upload this development content to Callstack's Sentry projects
as telemetry. This exclusion does not prevent a tool result from reaching the
host or content you deliberately email to support from reaching Callstack.

### Diagnostics and usage telemetry

Telemetry is enabled by default. The plugin's JavaScript and native components
send error/crash reports, sampled operation traces, usage counters, and aggregate
plugin performance measurements to Sentry. These help us identify failures and
slow operations and understand which product features are used.

Reports can contain scrubbed error descriptions and stack locations, operation
names and outcomes, version/environment information, bounded platform/device-kind
classifications, timestamps, timings, and plugin resource measurements. Usage
counters include feature views, tool outcomes, and actions such as searches or
attachments, without their content. These are measurements of the plugin, not
uploads of your app's recorded CPU/memory/FPS samples.

Error and crash reports include a random installation ID, persistent across
updates and restarts, and a random process-session ID. They are not derived from
your name, email, OpenAI account, device ID, or machine name. Because the
installation ID links reports over time, we treat it as pseudonymous information,
not a guarantee of anonymity. These IDs are excluded from performance metrics
and span attributes.

The reporting code excludes MCP arguments/results, screenshots, screen video,
app log content, typed/pasted text, app storage contents, profile contents, and
device performance recordings. It scrubs common secrets, email addresses, URLs,
and local home paths from error text. Session Replay, minidumps, and profiling
are disabled in the configured Sentry integrations. Scrubbing is a safeguard,
not a reason to put secrets into your test data.

### Updates and support

Release builds check GitHub for plugin updates. GitHub receives the network
request, including the connecting IP address and ordinary request metadata.
The check does not upload your project or device content. Installation uses the
host's marketplace update mechanism when you request an update.

If you contact support, we receive your email address, your message, and any
attachments you send. GitHub issues also expose your GitHub identity and issue
contents to people who can access the repository. Do not post sensitive reports
or personal data in public issues.

## 3. Purposes and legal grounds

We use information to provide requested functionality and support, diagnose
errors, maintain security, improve reliability and usability, and meet legal
obligations. We do not use Mobile Dev telemetry for advertising or sell it.

Where GDPR applies, our grounds are performance of our agreement or steps you
request before it for service/support activities; legitimate interests in
maintaining and improving a reliable, secure developer tool for appropriately
limited diagnostics; and compliance with applicable legal obligations. Where
consent is required, that processing requires consent and it may be withdrawn.
Accepting the Terms is not consent to optional processing. See section 6 for
telemetry controls and the right to object.

## 4. Recipients and international processing

- **Sentry:** processes the diagnostic and usage data described above for
  Callstack. The configured ingestion endpoints are in Sentry's German region.
  This alone is not a promise that every support, subprocessor, or administrative
  operation takes place exclusively in Germany.
- **OpenAI or another host you use:** receives tool results and content supplied
  through that host. Its processing and retention are governed by your relationship
  with that provider, not the Sentry opt-out.
- **GitHub:** hosts the repository, documents, releases, and issue tracker and
  handles update/download requests under its own policies.
- **Callstack personnel and service providers:** those handling support or
  diagnostics receive the information needed for that work, including our email
  and collaboration service providers.
- **Authorities or professional advisers:** information may be disclosed where
  required by law or necessary to establish, exercise, or defend legal claims.

Where personal data is transferred outside the EEA, applicable transfer
requirements must be met, such as an adequacy decision or appropriate contractual
safeguards. Contact us for information about safeguards applicable to your data.
See also [Sentry's privacy policy](https://sentry.io/privacy/),
[GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
and [OpenAI's privacy policy](https://openai.com/policies/privacy-policy/).

## 5. Retention

| Data | Retention and deletion |
| --- | --- |
| Sentry errors/crashes | 90 days under our Sentry Team plan. |
| Sentry performance spans and Application Metrics | 30 days under our Sentry Team plan. |
| Local live logs | Held in bounded memory buffers. A server log session expires after five minutes without reads or keep-alives; closing the session stops collection. Copies already attached to the host follow the host's retention. |
| Saved performance recordings | Stored under `~/Library/Application Support/mobile-dev/recordings` until you remove them; the recording store has no automatic age-based expiry. |
| TraceSift integration results/references and the chosen project folder | Stored under `~/.tracesift/integrations/mobile-dev` by default, or the corresponding `TRACE_SIFT_HOME` directory, until removed. Original profiles and the TraceSift service's own data are separate. |
| Installation ID | Stored at `~/Library/Application Support/mobile-dev/telemetry/anonymous-user-id` until you remove it. Process-session IDs last for the process; copies in sent reports follow Sentry retention. |
| Native crash-report caches | Pending reports can persist between runs under `~/Library/Caches/mobile-dev/sentry` or `/data/local/tmp/mobile-dev-sentry` on Android and be sent on a subsequent start. They can be removed after stopping the relevant processes. |
| Temporary app-storage database copies | Created locally for inspection and removed by the operation's cleanup handler. An interrupted process may leave temporary files for OS/manual cleanup. |
| Support correspondence | Kept while handling the request and for any further period needed for a specific legal obligation or claim; information no longer needed for those purposes is deleted. |

Sentry's [data retention periods](https://docs.sentry.io/security-legal-pii/security/data-retention-periods/) apply to active telemetry data. Sentry separately [reports deleting production event-data backups](https://www.sentry.help/en/articles/13965019-how-frequently-is-data-backed-up) 30 or 90 days after backup creation, depending on the data type; that guidance does not specify an Application Metrics-specific backup period. Active-data expiry does not imply immediate removal from backups.

Uninstalling the plugin does not necessarily remove saved recordings, identifiers,
crash caches, TraceSift files, host messages, or backups. GitHub, the host, your
operating system, and your own backup tools manage their copies separately.

## 6. Your choices and rights

- **Disable telemetry:** set `MOBILE_DEV_TELEMETRY=off` in the environment used to
  launch Mobile Dev's MCP server, then restart all running plugin processes.
  The setting disables new reporting across the integrated JavaScript/native
  components and prevents creation of a new installation ID. It does not delete
  reports already sent or disable GitHub update checks or host processing.
- **Reset the installation ID:** stop Mobile Dev processes and remove only the
  `anonymous-user-id` file listed above. A new ID is generated on the next start
  if telemetry remains enabled. This does not delete reports associated with the
  old ID; contact us before resetting it if you need help locating those reports.
- **Remove saved data:** stop the relevant tools and remove the specific local
  recordings, integration files, or caches you no longer need. Removing app
  storage is a separate, potentially destructive action against the selected app.
- **Limit access:** close sessions, disconnect devices, revoke debugging
  permissions, or disable/uninstall the plugin. Manage chat history and
  attachments through the host's own controls.

Subject to applicable law, you may request access, correction, erasure,
restriction, or portability of your personal data, object to processing based on
legitimate interests, and withdraw consent where processing relies on consent.
Email [hello@callstack.com](mailto:hello@callstack.com) with "Mobile Dev privacy"
in the subject. We may need proportionate information to verify your request or
locate pseudonymous reports. Do not send passwords or access tokens.

You may complain to your competent data protection authority, including the
President of the Polish Personal Data Protection Office (UODO). Exercising these
rights does not affect rights you have under other applicable laws.

## 7. Changes

We will publish revisions here with an updated date and identify material changes
in the release notes. Changes to this policy do not by themselves authorize new
processing that requires consent.

## Attribution and document license

Adapted from [Automattic's Privacy Policy](https://github.com/Automattic/legalmattic/blob/master/Privacy-Policy.md),
copyright Automattic, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Callstack replaced the hosted-service provisions with Mobile Dev's local-tool,
host-sharing, telemetry, retention, and support practices. This policy text is
also licensed under CC BY-SA 4.0. That license applies to this document, not to
the plugin software or Callstack trademarks. Automattic does not endorse Mobile Dev.
