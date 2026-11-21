if (
  process.env.MOBILE_DEV_SERVER_WORKER === "1" ||
  process.env.MOBILE_DEV_SIDECAR_STANDALONE === "1" ||
  process.env.MOBILE_DEV_NO_SUPERVISOR === "1"
) {
  await import("@mobile-dev/core/instrument.ts");
  // The server loads once telemetry runs, as a module of its own: the build splits the
  // bundle there, keeping each file under the Antigravity plugin directory's 5 MiB limit.
  await import("./server.ts");
} else {
  const { runHotReloadSupervisor } = await import("./supervisor.ts");
  await runHotReloadSupervisor(import.meta.url);
}
