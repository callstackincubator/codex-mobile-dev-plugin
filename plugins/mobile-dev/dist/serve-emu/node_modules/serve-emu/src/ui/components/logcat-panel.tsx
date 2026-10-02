import { useEffect, useRef, useState } from "react";
import {
  LogcatBatchPublisher,
  LogcatRingBuffer,
  type LogcatEntry,
} from "../lib/logcat-buffer";

type LogcatBatch = {
  lines?: unknown;
  totalDropped?: unknown;
  sourceDropped?: unknown;
};

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function parseLine(value: unknown): LogcatEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.line !== "string") return null;
  return {
    line: record.line,
    at: typeof record.at === "string" ? record.at : "",
  };
}

export function LogcatPanel() {
  const bufferRef = useRef<LogcatRingBuffer | null>(null);
  if (!bufferRef.current) bufferRef.current = new LogcatRingBuffer();
  const [view, setView] = useState(() => bufferRef.current!.snapshot());
  const publisherRef = useRef<LogcatBatchPublisher | null>(null);
  if (!publisherRef.current) {
    publisherRef.current = new LogcatBatchPublisher(
      bufferRef.current,
      setView,
    );
  }

  const eventSourceRef = useRef<EventSource | null>(null);
  const [packageName, setPackageName] = useState("");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("Off");
  const [serverDrops, setServerDrops] = useState({ queue: 0, source: 0 });

  const closeSource = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

  const connect = () => {
    closeSource();
    const params = new URLSearchParams();
    if (packageName.trim()) params.set("package", packageName.trim());
    if (search.trim()) params.set("search", search.trim());
    const source = new EventSource(`/api/logcat?${params}`);
    eventSourceRef.current = source;
    setEnabled(true);
    setPaused(false);
    setStatus("Connecting");
    setServerDrops({ queue: 0, source: 0 });

    const isCurrent = () => eventSourceRef.current === source;
    source.addEventListener("ready", () => {
      if (isCurrent()) setStatus("Streaming");
    });
    source.addEventListener("logs", (event) => {
      if (!isCurrent()) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as LogcatBatch;
        const lines = Array.isArray(data.lines)
          ? data.lines
              .map(parseLine)
              .filter((line): line is LogcatEntry => line !== null)
          : [];
        if (lines.length > 0) publisherRef.current?.append(lines);
        const nextDrops = {
          queue: nonNegativeInteger(data.totalDropped),
          source: nonNegativeInteger(data.sourceDropped),
        };
        setServerDrops((current) =>
          current.queue === nextDrops.queue &&
          current.source === nextDrops.source
            ? current
            : nextDrops,
        );
      } catch {}
    });
    // Keep compatibility with older servers while clients roll forward.
    source.addEventListener("log", (event) => {
      if (!isCurrent()) return;
      try {
        const line = parseLine(JSON.parse((event as MessageEvent).data));
        if (line) publisherRef.current?.append([line]);
      } catch {}
    });
    source.addEventListener("close", () => {
      if (isCurrent()) setStatus("Reconnecting");
    });
    source.addEventListener("error", (event) => {
      if (!isCurrent()) return;
      if (event instanceof MessageEvent && event.data) {
        setStatus("Logcat error");
      } else {
        setStatus("Reconnecting");
      }
    });
  };

  const disconnect = () => {
    closeSource();
    setEnabled(false);
    setPaused(false);
    setStatus("Off");
  };

  const togglePause = () => {
    if (!enabled) return;
    if (paused) {
      connect();
      return;
    }
    closeSource();
    setPaused(true);
    setStatus("Paused");
  };

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      publisherRef.current?.dispose();
    };
  }, []);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(view.text);
      setStatus("Copied");
    } catch {
      setStatus("Copy failed");
    }
  };

  const totalDropped =
    serverDrops.queue + serverDrops.source + view.dropped;
  const dropStatus =
    totalDropped > 0
      ? ` • dropped ${totalDropped} (server ${serverDrops.queue + serverDrops.source}, view ${view.dropped})`
      : "";

  return (
    <section className="tool-panel logcat-panel">
      <div className="panel-heading">
        <h2>Logcat</h2>
        <div className="location-status">
          {status} • {view.count}{dropStatus}
        </div>
      </div>
      <div className="coordinate-grid">
        <label>
          Package
          <input
            onChange={(e) => setPackageName(e.currentTarget.value)}
            placeholder="com.example.app"
            value={packageName}
          />
        </label>
        <label>
          Search
          <input
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="error"
            value={search}
          />
        </label>
      </div>
      <div className="panel-actions">
        <button onClick={connect}>{enabled ? "Apply" : "Start"}</button>
        <button onClick={disconnect} disabled={!enabled}>Stop</button>
        <button onClick={togglePause} disabled={!enabled}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={() => publisherRef.current?.clear()}>Clear</button>
        <button onClick={() => void copyLogs()}>Copy</button>
      </div>
      <pre className="logcat-output">
        {view.count > 0
          ? view.text
          : paused
            ? "Logcat is paused."
            : enabled
              ? "Waiting for logcat..."
              : "Logcat is off."}
      </pre>
    </section>
  );
}
