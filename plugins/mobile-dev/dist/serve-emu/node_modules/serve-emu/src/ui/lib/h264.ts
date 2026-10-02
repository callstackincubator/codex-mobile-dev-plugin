export function buildCodecString(spsHeaderAndPayload: Uint8Array): string {
  const profile = spsHeaderAndPayload[1].toString(16).padStart(2, "0");
  const constraints = spsHeaderAndPayload[2].toString(16).padStart(2, "0");
  const level = spsHeaderAndPayload[3].toString(16).padStart(2, "0");
  return `avc1.${profile}${constraints}${level}`;
}

export type ScanResult = {
  isKey: boolean;
  spsBytes: Uint8Array | null;
};

export function scanAU(buf: Uint8Array): ScanResult {
  let isKey = false;
  let spsBytes: Uint8Array | null = null;
  const len = buf.length;
  let i = 0;
  while (i + 2 < len) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      let codeLen = 0;
      if (buf[i + 2] === 1) codeLen = 3;
      else if (i + 3 < len && buf[i + 2] === 0 && buf[i + 3] === 1) codeLen = 4;
      if (codeLen) {
        const headerByte = buf[i + codeLen];
        const nalType = headerByte & 0x1f;
        if (nalType === 7 && !spsBytes) spsBytes = buf.subarray(i + codeLen);
        if (nalType === 5) isKey = true;
        i += codeLen + 1;
        continue;
      }
    }
    i++;
  }
  return { isKey, spsBytes };
}
