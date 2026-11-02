# Mobile Dev Terms of Service

Last updated: 22 October 2026

## 1. Provider and scope

These terms govern your use of the Mobile Dev plugin and related support
provided by **Callstack.io spółka z ograniczoną odpowiedzialnością** ("Callstack",
"we", "us"), ul. Prosta 36, 53-508 Wrocław, Poland, registered in the National
Court Register maintained by the District Court for Wrocław-Fabryczna in Wrocław,
VI Commercial Division, KRS 0000606530, NIP 8992785616, REGON 363921820.
Contact: [hello@callstack.com](mailto:hello@callstack.com).

Read these terms before using Mobile Dev. If you use it for an organization, you
must have authority to act for that organization. You must meet the age and
authorization requirements of your host application and applicable law, including
obtaining a parent or guardian's agreement where required.

These terms can be downloaded and saved from this repository. They describe the
functionality, technical requirements, responsibilities, ending use, and complaints
process for Mobile Dev. They do not govern Callstack consulting engagements or
other products such as Apex, which have separate agreements.

## 2. What Mobile Dev does

Mobile Dev runs local development tools to display and control iOS and Android
devices, inspect UI and app storage, read logs, record performance, analyze CPU
and React profiles through a local TraceSift service, and perform supported app
and device actions. Some actions change settings, install or remove apps, forward
network traffic, or clear app data. The supported operations and limitations are
described in the [README](README.md) and documentation.

You need a compatible desktop host and the platform tools, devices, and debugging
permissions listed in the README. Some features require separate software such
as Xcode, the Android SDK, Metro, or TraceSift. Device/OS capabilities affect
availability; for example, iOS simulators do not provide Display FPS.

Mobile Dev does not currently require a separate Callstack account or a plugin
subscription. Host applications, development tools, and other providers may have
their own fees and terms. These terms do not authorize Callstack to charge you
for a future paid offering without a separate agreement.

## 3. Your use and responsibilities

Use Mobile Dev only with projects, devices, apps, and data you are authorized to
access. You are responsible for obtaining any permissions needed to process
other people's information and for complying with applicable law and the terms
of your host and platform providers.

Do not use Mobile Dev to access systems without permission, bypass security or
access controls, distribute malware, unlawfully monitor people, infringe others'
rights, or supply unlawful content. Do not ask it to collect or expose passwords,
API keys, payment-card data, health records, or government identifiers. Prefer
synthetic data and development builds.

Review the selected target and requested action before changing device settings,
uninstalling apps, or clearing storage. Keep backups of data you need. Check
generated code, diagnoses, and performance conclusions before relying on them:
AI-generated results can be wrong, measurements depend on the environment, and
device-wide FPS does not isolate one app's performance.

## 4. Software, third parties, and your content

Callstack permits you to install and use the Mobile Dev releases it distributes
for the development workflows described in these terms. Components supplied
under separate licenses remain governed by those licenses; these terms do not
remove any rights those licenses grant. See [Third-party notices](THIRD_PARTY_NOTICES.md)
and the notices included with each component. This document does not relicense
the repository as a whole or grant rights to Callstack trademarks.

You keep your rights in your code, app content, profiles, and other material you
provide. These terms do not give Callstack a general right to publish that content
or use it to train models. Processing performed locally or through the host is
limited to the features you use and is described in the [Privacy Policy](PRIVACY.md).
Materials you deliberately send to support may be used to address your request.

OpenAI, GitHub, Apple, Google, and other third-party products are governed by their
own terms and policies. Your use of Mobile Dev does not give Callstack control
over those providers' availability, model behavior, or data-retention settings.
Naming them does not imply endorsement.

## 5. Privacy

The [Privacy Policy](PRIVACY.md) explains local processing, tool results supplied
to the host, Sentry diagnostics enabled by default, saved data, and your controls.
You can disable new telemetry by setting `MOBILE_DEV_TELEMETRY=off` in the MCP
launch environment and restarting the plugin processes. Agreeing to these terms
does not substitute for consent where the law requires it.

## 6. Updates, availability, and ending use

We may release fixes and change supported features or platform requirements.
Release builds check for available updates; an update requested through Mobile
Dev uses the host's marketplace mechanism. Review release notes when updating.
We do not promise uninterrupted availability, compatibility with every device,
or a particular support response time unless separately agreed or required by law.

You may stop using Mobile Dev at any time by closing its sessions and disabling
or uninstalling it through your host. Saved local files and information already
sent to the host or diagnostics service may remain as described in the Privacy
Policy. Uninstalling Mobile Dev does not undo changes you made to an app or device.

We may stop distributing a release or providing support, or restrict services we
operate where required by law or necessary to address misuse or security risks.
This does not revoke rights you hold under a separate software license or allow
us to erase your local projects. Mandatory consumer rights remain unaffected.

## 7. Warranties and liability

To the extent permitted by applicable law, Mobile Dev is provided "as is" and
"as available", without a promise that it will be error-free or fit every
particular purpose. To the extent permitted by law, Callstack is not liable for
indirect or consequential loss arising from use of the plugin.

Nothing in these terms excludes or limits liability that cannot lawfully be
excluded or limited, including liability for intentional misconduct or applicable
mandatory consumer remedies. Separate component licenses may contain their own
warranty and liability provisions. These terms do not override mandatory legal
rights regarding conformity, updates, withdrawal, or termination of digital
content or services.

## 8. Support and complaints

Email [hello@callstack.com](mailto:hello@callstack.com) with "Mobile Dev support"
or "Mobile Dev complaint" in the subject, or write to our postal address. Explain
the issue, when it happened, the relevant version, and the remedy you seek.
Use a minimal reproduction and remove confidential content. See [Support](SUPPORT.md).
We handle complaints within the deadlines required by applicable law.

If applicable law grants a right to withdraw, you may exercise it by a clear
statement sent to the same contact address. No provision here waives that right
or treats installation alone as consent to waive it. You may also seek help from
your local consumer authority or an applicable alternative dispute-resolution body.

## 9. Changes and governing law

We may update these terms to reflect changes in law, the product, or its
dependencies, or to correct or clarify the text. We will publish the updated
version with its date and identify material changes in release notes. Changes
are not retroactive; any notice or agreement required by law must still be provided
or obtained. You may stop using Mobile Dev if you do not accept revised terms.

Polish law governs these terms. Consumers retain the protection of mandatory
rules in their country of habitual residence and any right to bring proceedings
in their local courts. These terms do not require arbitration or waive class,
collective, or statutory remedies. If a provision is unenforceable, the remainder
continues to apply to the extent permitted by law.

## Attribution and document license

Adapted from [Automattic's Terms of Service](https://github.com/Automattic/legalmattic/blob/master/Terms%20of%20Service/WordPress.com/EN-Terms-of-Service.md),
copyright Automattic, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Callstack narrowed the scope to a local developer plugin, removed hosted-account,
commerce, content-publication, and US arbitration provisions, and added Mobile
Dev's operational boundaries and Polish-provider context. This terms text is
also licensed under CC BY-SA 4.0. That license applies to this document, not to
the plugin software or Callstack trademarks. Automattic does not endorse Mobile Dev.
