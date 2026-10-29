import { useCallback, useState } from "react";

/** Copies text to the clipboard and reports how it went in `status`, for a live region or label. */
export function useCopy({ copied = "Copied", failed = "Could not copy" }: { copied?: string; failed?: string } = {}) {
  const [status, setStatus] = useState("");
  const copy = useCallback(async (text: string) => {
    // Clearing first announces a repeated result again.
    setStatus("");
    try { await navigator.clipboard.writeText(text); setStatus(copied); }
    catch { setStatus(failed); }
  }, [copied, failed]);
  return [copy, status] as const;
}
