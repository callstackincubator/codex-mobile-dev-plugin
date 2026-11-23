function getTraceAttemptKey(trace) {
	return `${trace.repeats}:${trace.retry}`;
}
function groupTraceAttempts(traces) {
	const grouped = new Map();
	for (const trace of traces) {
		const key = getTraceAttemptKey(trace);
		const group = grouped.get(key);
		if (group) {
			group.push(trace);
		} else {
			grouped.set(key, [trace]);
		}
	}
	const merged = new Map();
	for (const [key, traces] of grouped) {
		merged.set(key, {
			...traces[0],
			entries: normalizeTraceEntries(traces.flatMap((trace) => trace.entries))
		});
	}
	return merged;
}
function normalizeTraceEntries(entries) {
	const merged = [];
	const startMap = new Map();
	const parents = [];
	for (const entry of entries) {
		const range = entry.range;
		if (!range) {
			merged.push({
				...entry,
				depth: parents.length
			});
			continue;
		}
		if (range.phase === "start") {
			startMap.set(range.id, merged.length);
			merged.push({
				...entry,
				depth: parents.length
			});
			parents.push(range.id);
			continue;
		}
		// when range.phase === 'end'
		const index = startMap.get(range.id);
		if (index == null) {
			// unpaired range shouldn't happen but just leave it there
			merged.push({
				...entry,
				depth: 0
			});
			continue;
		}
		// Keep the start timestamp for positioning, but derive display duration
		// from the end event timestamp.
		const start = merged[index];
		merged[index] = {
			...start,
			...entry,
			startTime: start.startTime,
			duration: entry.startTime - start.startTime
		};
		parents.pop();
	}
	return merged;
}

export { getTraceAttemptKey, groupTraceAttempts };
