# Storage results and sensitive data

`mobile_app_storage`, `mobile_app_storage_table`, and `mobile_app_storage_file`
return data to the host and to the Storage panel. Sentry scrubbing does not cover this boundary. The storage
reader now filters complete values before length truncation or MCP serialization;
the text and structured results contain the same filtered data. There is no
raw-value flag or panel-only bypass.

## What is filtered

- Recognized sensitive key/column names (including password, token, auth, cookie,
  session, API/private keys, and common personal-data fields), including nested
  JSON objects and arrays. Sensitive store/table names also redact their values.
- Credential-shaped text such as authorization headers, JWTs, common provider
  tokens, private keys, URL credentials, credential assignments, email addresses,
  and long opaque strings that may encode credentials.
- Binary values, including SQLite blobs, decoded key/value binary entries, and the
  contents of binary files.
- Generic SQLite value columns when the same row's key/name label identifies a
  sensitive field, including when the caller projects only the value column.
- Malformed JSON-like values and values beyond bounded redaction depth/size limits
  are withheld. The filter runs before truncation so it cannot return a token prefix.
- Credential-looking keys are replaced and their values withheld; suspicious
  path components are omitted from file/store listings. Such stores may therefore
  be unavailable for inspection. Long hashes can also be hidden by this rule.
- Raw command/SQLite error text is never returned. Failures use fixed recovery
  messages based on outcome, keeping paths and diagnostics out of host results.
  Clear-store success returns a generic confirmation, not an echoed store name.

This is conservative, heuristic filtering. It may hide benign identifiers or
values and cannot recognize every secret, encoding, medical record, personal
name, or arbitrary sensitive string. Use synthetic development data. A successful
filter is not a claim that a result is safe to publish. Screenshots, logs,
profiles, accessibility results and other tool families are outside this filter.
Source app storage is not modified by inspection. Because redacted values are
stable placeholders, the Changes tab cannot reveal changes within those values.

## Narrow the request

Use the device ID and bundle/package ID of the intended app. In
`mobile_app_storage`, `store` is matched to the actual container listing **before
any store content is read**. Unselected stores are not decoded and their file
metadata is excluded. An invalid store fails rather than returning a broader
snapshot. `keys` accepts up to 100 exact names and requires `store`; it filters
entries returned from that store. Some formats still require reading/decoding the
whole selected store locally. Omit these selectors for the panel's app-wide,
filtered overview.

For `mobile_app_storage_table`, `store` and `table` are always required. `columns`
accepts up to 100 exact names, validated against the schema and quoted as SQL
identifiers. Unselected columns are not selected except local key/name labels
needed for credential filtering. Known sensitive columns and blobs are replaced
in the SQL result itself. Use a small `limit` and explicit `offset`. Temporary
SQLite copies are cleaned up as before.

`mobile_app_storage_file` reads one file from the listing; suspicious paths are
rejected like they are omitted from listings. JSON, property list, and
NSKeyedArchiver contents are filtered as one structured value with the file name as
context, so a sensitive file name such as `session.json` withholds the whole file.
Text files are withheld when they contain credential-like text. Binary files return
no content. Files over the preview size limit are not read.

File counts/sizes describe the requested scope after suspicious paths are
excluded, not the complete disk usage. Entry counts describe decoded entries
before the optional key projection and display cap.

## Verification

Run `node --test tests/app-storage.test.ts tests/app-storage-redaction.test.ts`.
The tests exercise real MCP responses, both output channels, selected/unselected
stores, nested and malformed JSON, redaction before truncation, credential column
projection, actual SQLite blobs and key/value rows, static errors, pagination,
and unchanged source database bytes. They use synthetic secrets only.

Before submission, demonstrate the final ZIP on a synthetic app containing
`password`, `access_token`, a harmless `theme` value, nested JSON credentials, and
a SQLite `key`/`value` table. Show `[REDACTED]` in the tool result and panel,
`theme` still readable, one-store scope excluding unrelated stores, and a projected
value column still redacted for a credential row. Do not record production data.
