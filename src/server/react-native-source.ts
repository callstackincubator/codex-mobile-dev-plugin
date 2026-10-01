import { parseBaseUrl } from "../shared/protocol.ts";
import type { InspectorNode } from "./react-native-inspector.ts";
import type { ReactElementContext } from "../shared/screen-annotations.ts";

export type CreationFrame = { url: number; line: number; column: number; methodName: string };
type MappedFrame = { file?: string; lineNumber?: number; column?: number; methodName?: string; collapse?: boolean };

// Resolve one bounded batch using the app's existing Metro source maps. No file search.
export async function resolveReactNativeSources(nodes: InspectorNode[], urls: string[], stacks: CreationFrame[][], origin: string, signal?: AbortSignal) {
  const base = parseBaseUrl(origin, "Metro URL");
  const frames: { file: string; lineNumber: number; column: number; methodName: string }[] = [];
  const indices = stacks.map(stack => stack.flatMap(frame => {
    const file = urls[frame.url];
    if (!file) return [];
    let url: URL;
    try { url = new URL(file); } catch { return []; }
    if (url.protocol !== base.protocol || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== base.port || url.username || url.password || url.hash) return [];
    const index = frames.length;
    frames.push({ file, lineNumber: frame.line, column: frame.column, methodName: frame.methodName });
    return [index];
  }));
  if (!frames.length) return;
  const response = await fetch(new URL("/symbolicate", base), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stack: frames }),
    redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) return;
  const text = await response.text();
  if (text.length > 1024 * 1024) return;
  const body: { stack?: MappedFrame[] } = JSON.parse(text);
  if (!Array.isArray(body.stack) || body.stack.length !== frames.length) return;
  const mapped = body.stack;
  function location(frame: MappedFrame | undefined): ReactElementContext["source"] {
    if (!frame || typeof frame.file !== "string" || !frame.file || frame.file.length > 2048 || /:\/\/|(?:^|[/\\])node_modules[/\\]|\.bundle(?:[/?]|$)/.test(frame.file) || frame.collapse === true
      || typeof frame.lineNumber !== "number" || !Number.isInteger(frame.lineNumber) || frame.lineNumber <= 0) return;
    return { file: frame.file, line: frame.lineNumber,
      ...(typeof frame.column === "number" && Number.isInteger(frame.column) && frame.column >= 0 ? { column: frame.column + 1 } : {}),
      ...(typeof frame.methodName === "string" ? { functionName: frame.methodName.slice(0, 256) } : {}),
    };
  }
  for (const node of nodes) {
    if (node.react) {
      const source = node.creationStackIds?.flatMap(id => indices[id] ?? []).map(index => location(mapped[index])).find(Boolean);
      if (source) node.react = { ...node.react, source };
    }
  }
}
