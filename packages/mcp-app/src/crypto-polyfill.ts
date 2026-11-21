// Nested http://127.0.0.1 and about:srcdoc iframes inside custom-scheme IDE webviews
// (such as vscode-webview://) run with isSecureContext === false in Chromium, where
// crypto.randomUUID is omitted while crypto.getRandomValues remains available.
export function installRandomUUIDPolyfill(
  target: { getRandomValues?: (array: Uint8Array) => Uint8Array; randomUUID?: () => string } | undefined = globalThis.crypto,
) {
  if (!target || typeof target.getRandomValues !== "function" || typeof target.randomUUID === "function") return;
  const hex = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = new Uint8Array(16);
    target.getRandomValues!(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    return `${hex[bytes[0]!]!}${hex[bytes[1]!]!}${hex[bytes[2]!]!}${hex[bytes[3]!]!}-${hex[bytes[4]!]!}${hex[bytes[5]!]!}-${hex[bytes[6]!]!}${hex[bytes[7]!]!}-${hex[bytes[8]!]!}${hex[bytes[9]!]!}-${hex[bytes[10]!]!}${hex[bytes[11]!]!}${hex[bytes[12]!]!}${hex[bytes[13]!]!}${hex[bytes[14]!]!}${hex[bytes[15]!]!}`;
  };
  try {
    Object.defineProperty(target, "randomUUID", { configurable: true, writable: true, value: randomUUID });
  } catch {
    try {
      Object.defineProperty(Object.getPrototypeOf(target), "randomUUID", { configurable: true, writable: true, value: randomUUID });
    } catch {}
  }
}

installRandomUUIDPolyfill();
