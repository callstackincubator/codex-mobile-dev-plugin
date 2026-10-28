import "@mobile-dev/core/instrument.ts";

// The server loads once telemetry runs, as a module of its own: the build splits the
// bundle there, keeping each file under the Claude plugin directory's 5 MiB limit.
await import("./server.ts");
