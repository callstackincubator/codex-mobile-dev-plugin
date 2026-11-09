import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { appIntelQueryInput, generateAppIntelInput } from "@mobile-dev/shared/app-intelligence.ts";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { pickProjectFolder } from "../profile-picker.ts";
import { lookupAppIntel } from "./lookup.ts";
import { AppIntelligenceService } from "./service.ts";
import { recordAppIntelOperation } from "../telemetry.ts";

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], structuredContent: typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined });
const failure = (error: unknown) => ({ isError: true as const, content: [{ type: "text" as const, text: errorMessage(error) }] });

export function registerAppIntelligenceTools(server: McpServer, service: AppIntelligenceService) {
  server.registerTool("mobile_generate_app_intel", {
    title: "Generate App Intelligence",
    description: "Analyze a React Native project's Expo Router and React Navigation screens plus its static import graph for iOS and Android. App Intelligence discovers screens itself; App Flow does not need to run first. Pass projectPath to override the folder remembered by the panel. When the user asked to create or see the app's map, follow this with mobile_open_app_intel to render it in chat.",
    inputSchema: generateAppIntelInput.shape, annotations: write,
  }, async (input, context) => {
    const startedAt = performance.now();
    try {
      const result = await service.generate(input.projectPath, context.signal);
      recordAppIntelOperation("generate", "success", performance.now() - startedAt);
      return text({ projectPath: result.projectPath, analyzedAt: result.snapshot.meta.analyzedAt, generation: result.snapshot.meta.generation, files: Object.keys(result.snapshot.files).length, screens: Object.keys(result.snapshot.screens).length, packages: Object.keys(result.snapshot.packages).length, diagnostics: result.snapshot.diagnostics.length });
    } catch (error) { recordAppIntelOperation("generate", context.signal.aborted ? "cancelled" : "failed", performance.now() - startedAt); return failure(error); }
  });

  server.registerTool("mobile_app_intel", {
    title: "Query App Intelligence",
    description: "Query a saved React Native App Intelligence graph. Use operation=screen for a screen's dependencies, file for importers/imports, and search when the exact screen ID or project-relative file is unknown. direction=incoming finds consumers; outgoing finds dependencies. Read the compact summary first and paginate only when nextOffset is present. Pass projectPath to override the folder remembered by the panel. When the user asked about a screen by name and wants it shown, not just answered, search here for its ID, then call mobile_open_app_intel with that screen ID to render its dependency graph in chat.",
    inputSchema: appIntelQueryInput.shape, annotations: read,
  }, async raw => {
    const startedAt = performance.now();
    try {
      const input = appIntelQueryInput.parse(raw);
      const { projectPath, snapshot } = await service.snapshot(input.projectPath);
      if (!snapshot) return text(`No App Intelligence snapshot exists for ${projectPath}. Run mobile_generate_app_intel first.`);
      const result = text({ projectPath, ...lookupAppIntel(snapshot, input) }); recordAppIntelOperation("query", "success", performance.now() - startedAt); return result;
    } catch (error) { recordAppIntelOperation("query", "failed", performance.now() - startedAt); return failure(error); }
  });

  registerAppTool(server, "mobile_pick_app_intel_project", {
    title: "Choose App Intelligence project", description: "Open the host folder picker for App Intelligence. Pressing Cancel keeps the current project.",
    inputSchema: {}, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, async () => {
    const startedAt = performance.now();
    try {
      const picked = await pickProjectFolder();
      if (!picked.picked) { recordAppIntelOperation("pick", "cancelled", performance.now() - startedAt); return text({ picked: false }); }
      const projectPath = await service.project(picked.path, true);
      recordAppIntelOperation("pick", "success", performance.now() - startedAt);
      return text({ picked: true, projectPath });
    } catch (error) { recordAppIntelOperation("pick", "failed", performance.now() - startedAt); return failure(error); }
  });

  registerAppTool(server, "mobile_select_app_intel_project", {
    title: "Switch App Intelligence project", description: "Switch App Intelligence to a project the panel already knows, and remember it as the current one.",
    inputSchema: { projectPath: z.string().min(1).max(4096) }, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, async input => {
    const startedAt = performance.now();
    try { const result = text(await service.snapshot(input.projectPath, true)); recordAppIntelOperation("pick", "success", performance.now() - startedAt); return result; }
    catch (error) { recordAppIntelOperation("pick", "failed", performance.now() - startedAt); return failure(error); }
  });

  registerAppTool(server, "mobile_app_intel_snapshot", {
    title: "Read App Intelligence snapshot", description: "Read the selected App Intelligence snapshot for the shared visualization.",
    inputSchema: generateAppIntelInput.shape, annotations: read, _meta: { ui: { visibility: ["app"] } },
  }, async input => {
    const startedAt = performance.now();
    try { const result = text(await service.snapshot(input.projectPath)); recordAppIntelOperation("snapshot", "success", performance.now() - startedAt); return result; }
    catch (error) {
      recordAppIntelOperation("snapshot", "failed", performance.now() - startedAt);
      const recents = await service.recents().catch(() => []);
      return recents.length ? { ...failure(error), structuredContent: { recents } } : failure(error);
    }
  });

  registerAppTool(server, "mobile_app_intel_status", {
    title: "Read App Intelligence status", description: "Read the selected project and current App Intelligence generation state.",
    inputSchema: generateAppIntelInput.shape, annotations: read, _meta: { ui: { visibility: ["app"] } },
  }, async input => {
    try { return text(await service.status(input.projectPath)); }
    catch (error) { return failure(error); }
  });

  registerAppTool(server, "mobile_clear_app_intel", {
    title: "Clear the App Intelligence graph", description: "Delete the saved App Intelligence graph for the selected project. The project stays selected and can be analyzed again.",
    inputSchema: generateAppIntelInput.shape, annotations: destructive, _meta: { ui: { visibility: ["app"] } },
  }, async input => {
    const startedAt = performance.now();
    try { const result = text(await service.clear(input.projectPath)); recordAppIntelOperation("clear", "success", performance.now() - startedAt); return result; }
    catch (error) { recordAppIntelOperation("clear", "failed", performance.now() - startedAt); return failure(error); }
  });

  registerAppTool(server, "mobile_cancel_app_intel", {
    title: "Cancel App Intelligence generation", description: "Cancel App Intelligence generation before its atomic save.",
    inputSchema: generateAppIntelInput.shape, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, async input => {
    try { await service.cancel(input.projectPath); return text({ cancelled: true }); }
    catch (error) { return failure(error); }
  });
}

