type BrowserTraceEntryKind = "action" | "expect" | "mark" | "lifecycle";
type BrowserTraceEntryStatus = "pass" | "fail";
interface BrowserTraceData {
	retry: number;
	repeats: number;
	recordCanvas?: boolean;
	entries: BrowserTraceEntry[];
}
interface BrowserTraceEntry {
	name: string;
	kind: BrowserTraceEntryKind;
	range?: {
		id: string;
		phase: "start" | "end";
	};
	status?: BrowserTraceEntryStatus;
	startTime: number;
	duration?: number;
	stack?: string;
	location?: {
		file: string;
		line: number;
		column: number;
	};
	element?: {
		selector: string;
		locator: string;
	};
	snapshot?: BrowserTraceSnapshot;
}
interface BrowserTraceSnapshot {
	serialized: unknown;
	viewport: {
		width: number;
		height: number;
	};
	scroll: {
		x: number;
		y: number;
	};
	selectorIds?: number[];
	selectorResolution?: "matched" | "missing" | "error";
	selectorError?: string;
	pseudoClassIds: Record<string, number[]>;
	ariaSnapshot?: string;
}
interface NormalizedBrowserTraceData extends Omit<BrowserTraceData, "entries"> {
	entries: NormalizedBrowserTraceEntry[];
}
interface NormalizedBrowserTraceEntry extends BrowserTraceEntry {
	depth: number;
}
declare function getTraceAttemptKey(trace: {
	retry: number;
	repeats: number;
}): string;
declare function groupTraceAttempts(traces: BrowserTraceData[]): Map<string, NormalizedBrowserTraceData>;

export { getTraceAttemptKey, groupTraceAttempts };
export type { BrowserTraceData, BrowserTraceEntry, BrowserTraceEntryKind, BrowserTraceEntryStatus, BrowserTraceSnapshot, NormalizedBrowserTraceData, NormalizedBrowserTraceEntry };
