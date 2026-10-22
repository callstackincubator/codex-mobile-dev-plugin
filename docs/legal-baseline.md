# Policy sources and publication checks

These documents are adapted drafts for the Mobile Dev directory submission, not
a claim that a template has been legally approved for this product.

## Reusable baseline

The baseline is [Automattic/legalmattic](https://github.com/Automattic/legalmattic):

- [Privacy Policy](https://github.com/Automattic/legalmattic/blob/master/Privacy-Policy.md)
- [Terms of Service](https://github.com/Automattic/legalmattic/blob/master/Terms%20of%20Service/WordPress.com/EN-Terms-of-Service.md)
- [Upstream license](https://github.com/Automattic/legalmattic/blob/master/LICENSE.txt),
  Creative Commons Attribution-ShareAlike 4.0.

Sources were consulted on 22 October 2026. Each adapted document credits Automattic,
links to the source and license, describes the changes, and licenses its text
under CC BY-SA 4.0. No software or trademark license is changed.

The privacy structure follows scope, collection, purposes, sharing, retention,
choices, rights, and changes. The terms retain the general service/responsibility,
third-party, warranty, ending-use, and changes structure. WordPress hosting,
advertising, subscriptions, broad content licenses, and US arbitration are removed.

Callstack's identity comes from its published
[corporate privacy policy](https://www.callstack.com/documents/privacy-policy)
and [Apex terms](https://apex.callstack.com/legal/terms). The
[individual-user terms](https://apex.callstack.com/legal/individual-terms) inform
the preservation of mandatory consumer rights. Apex billing, API-key, model,
zero-retention, and service-level provisions do not apply to Mobile Dev and were
not imported. Support uses hello@callstack.com.

## Implementation evidence

The descriptions were checked against `src/server/instrument.ts`,
`src/shared/telemetry.ts`, `src/server/telemetry-identity.ts`,
`src/server/performance-recordings.ts`, `src/server/log-sessions.ts`,
`src/server/tracesift-client.ts`, `src/server/app-storage/reader.ts`,
`src/server/app-control/commands.ts`, `src/server/network-throttle/proxy.ts`,
`src/server/plugin-updates.ts`, and `docs/telemetry.md` on the v0.1.162 source.

The policy distinguishes local tool data and results reaching the host from
Callstack's Sentry telemetry; it does not promise zero collection or that all
data stays on-device. Persistent random IDs are described as pseudonymous.

## Before publishing the policy and resubmitting

- [ ] Fill the explicit Sentry retention TODO in `PRIVACY.md` from the actual
  project settings, including errors/crashes, traces, metrics, and deletion delays.
- [ ] Have Callstack's policy owner confirm the proposed legal grounds for
  default-on diagnostics, including whether the installation ID or usage analytics
  requires an additional consent mechanism in supported markets. Disclosure alone
  does not establish that default-on collection is lawful.
- [ ] Confirm the Sentry processing agreement, region/subprocessor and transfer
  arrangements, and support-retention practice against the proposed policy.
- [ ] Review the terms for the intended distribution and consumer audience.
- [ ] Merge the documents and verify every manifest URL while signed out. The
  `blob/main` URLs intentionally target the eventual published documents, not this
  review branch. Do not submit while the policy still contains a TODO.

These checks concern publication readiness. This PR does not change runtime
collection, consent controls, repository-wide licensing, or release versioning.
