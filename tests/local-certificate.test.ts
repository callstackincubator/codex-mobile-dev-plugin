import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacLocalCertificate } from "../src/server/local-certificate.ts";
import { fakeCertificate } from "./fixtures.ts";

const scopedTrust = '<array><dict><key>kSecTrustSettingsPolicyString</key><string>127.0.0.1</string></dict></array>';
const sslTrust = '<array><dict><key>kSecTrustSettingsPolicyName</key><string>sslServer</string></dict></array>';

test("hostname-scoped trust is not browser-ready; explicit setup repairs it without regenerating keys", async t => {
  const material = await fakeCertificate();
  const temporaryRoot = tmpdir();
  const prefix = join(temporaryRoot, "mobile-dev-certificate-test-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, "localhost.key");
  const certPath = join(directory, "localhost.crt");
  await writeFile(keyPath, material.key);
  await writeFile(certPath, material.cert);
  let trust = scopedTrust;
  const calls: { command: string; args: string[] }[] = [];
  const certificate = new MacLocalCertificate(directory, async (command, args) => {
    calls.push({ command, args });
    if (command === "/usr/bin/plutil") return trust;
    if (args[0] === "add-trusted-cert") trust = sslTrust;
    return "";
  });
  const before = await certificate.status();
  assert.equal(before.state, "untrusted");
  assert.equal(await certificate.material(), undefined);
  assert.equal(calls.some(call => call.args[0] === "add-trusted-cert"), false);
  const after = await certificate.setup();
  assert.equal(after.state, "ready");
  const repair = calls.find(call => call.args[0] === "add-trusted-cert");
  assert.ok(repair);
  assert.equal(repair.args.includes("-s"), false);
  assert.equal(repair.args[repair.args.indexOf("-p") + 1], "ssl");
  assert.equal(calls.some(call => call.command === "/usr/bin/openssl"), false);
  const keyAfter = await readFile(keyPath);
  const certAfter = await readFile(certPath);
  assert.deepEqual(keyAfter, material.key);
  assert.deepEqual(certAfter, material.cert);
  assert.deepEqual(await certificate.material(), { key: material.key, cert: material.cert });
  await certificate.setup();
  assert.equal(calls.filter(call => call.args[0] === "add-trusted-cert").length, 1);
});

test("a missing certificate performs no Keychain reads or writes", async t => {
  const temporaryRoot = tmpdir();
  const prefix = join(temporaryRoot, "mobile-dev-certificate-test-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const certificate = new MacLocalCertificate(directory, async () => { calls++; return ""; });
  assert.deepEqual(await certificate.status(), { state: "missing" });
  assert.equal(calls, 0);
});
