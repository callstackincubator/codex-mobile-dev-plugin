import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { installRandomUUIDPolyfill } from "../../../packages/mcp-app/src/crypto-polyfill.ts";

test("installRandomUUIDPolyfill provides valid v4 UUIDs when crypto.randomUUID is absent", () => {
  const target: { getRandomValues: (array: Uint8Array) => Uint8Array; randomUUID?: () => string } = {
    getRandomValues: buf => webcrypto.getRandomValues(buf),
  };

  installRandomUUIDPolyfill(target);
  assert.equal(typeof target.randomUUID, "function");

  const seen = new Set<string>();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (let i = 0; i < 32; i++) {
    const id = target.randomUUID!();
    assert.match(id, uuidV4);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});
