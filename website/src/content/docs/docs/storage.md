---
title: Storage
description: Inspect app preferences, databases, files, and live changes without adding app code, with scoped requests and filtered results.
---

Open **Storage** to see what the selected app has saved without adding code to it. It works with React Native and native apps on **iOS simulators** and **debuggable Android builds**.

## Browse app data

Mobile Dev can inspect:

- UserDefaults and shared App Group containers.
- Core Data and SwiftData stores.
- Android SharedPreferences and DataStore.
- MMKV and AsyncStorage.
- SQLite databases and the largest files in the app's data directory.

SDK data from services such as Firebase and Google Analytics is grouped separately. MMKV value types are inferred from the stored bytes. Encrypted MMKV and EncryptedSharedPreferences remain locked; Proto DataStore fields appear by number when no schema is available.

## Read a table or file

Open a SQLite table to page through its rows. Open a listed file to preview supported text or decode JSON, property lists, and NSKeyedArchiver archives. Binary content is withheld, and files above the preview size limit are not read.

Search across stores to locate a value, or ask your agent for a specific store, key, table, or set of columns. Narrow requests keep unrelated data out of the result. An invalid store fails rather than returning a broader app snapshot.

For example:

> Inspect the onboarding flag in this app's preferences.

> Show the schema and the first rows of the trips table.

Use synthetic development data for these workflows.

## Watch changes

Open **Changes** while you use the app to see keys being added, changed, and removed. For JSON values, the changed portion is highlighted.

Inspection does not modify the source app storage. Redacted values use stable placeholders, so the Changes view cannot reveal changes inside them.

## Filtered results

Storage results are filtered before they reach the panel or host. Recognized sensitive fields and credential-like values appear as `[REDACTED]`; binary values are withheld. The same filtering applies to the structured results your agent receives.

The filter covers recognized sensitive key and column names, nested JSON values, credential-shaped text, and some suspicious file or store names. It runs before truncation and can hide a whole file or value. It may also withhold benign opaque identifiers.

This is heuristic filtering: it cannot recognize every secret or personal detail and does not establish that a result is safe to publish. It does not filter screenshots, logs, profiles, accessibility results, or other tool families. Review content before sharing it with your ADE.

## Clear a store or reset app data

You can clear one store or reset all app data to test a fresh state, such as first launch or onboarding. This stops the app and deletes the selected data. Check the target and confirm you do not need that data before proceeding; deleted data cannot be recovered through Mobile Dev.

Storage contents are excluded from Mobile Dev's Sentry telemetry. Data returned to the host is handled separately; read [Privacy](/docs/privacy) and the source [storage filtering details](https://github.com/callstackincubator/mobile-dev/blob/main/docs/storage-privacy.md).
