import { z } from "zod";
import { PLUGIN_VERSION } from "./version.ts";

export const TRACESIFT_URI = `ui://mobile-dev/${PLUGIN_VERSION}/tracesift.html`;
export const traceSiftProfileTypeSchema = z.enum(["auto", "cpu", "react"]);
export type TraceSiftProfileType = z.infer<typeof traceSiftProfileTypeSchema>;
export const traceSiftProfileInputSchema = z.object({
  path: z.string().min(1).max(16_384), profileType: traceSiftProfileTypeSchema.default("auto"),
});

/**
 * A web address the panel may ask TraceSift to record.
 *
 * Only http and https: the CLI hands this to Chrome as an argument, and a
 * `file:` or `javascript:` address typed into the panel is not a web app to
 * profile.
 */
export const traceSiftCaptureUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; }
  catch { return false; }
}, "Enter an http:// or https:// address.");

/**
 * The Metro dev server a React Native recording attaches through.
 *
 * Loopback only, and an origin rather than a page: the inspector lives at
 * `/json/list` on this server, and a path typed here would only be dropped.
 */
export const traceSiftMetroUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)
      && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}, "Enter a Metro address such as http://127.0.0.1:8081.");

/** One React Native app connected to Metro, as `record targets --platform rn --json` reports it. */
export const traceSiftRnTargetSchema = z.object({
  id: z.string(), title: z.string(),
  appId: z.string().optional(), deviceName: z.string().optional(), deviceId: z.string().optional(),
  /** Absent on React Natives that do not name their engine; present ones say `Hermes`. */
  vm: z.string().optional(),
  supportsMultipleDebuggers: z.boolean().default(false),
  /** The one `record start --platform rn` would pick on its own. */
  recommended: z.boolean().default(false),
});
export type TraceSiftRnTarget = z.infer<typeof traceSiftRnTargetSchema>;

export const traceSiftRnTargetsSchema = z.object({
  apiVersion: z.literal(1), platform: z.literal("rn"), metro: z.string(),
  targets: z.array(traceSiftRnTargetSchema),
});
export type TraceSiftRnTargets = z.infer<typeof traceSiftRnTargetsSchema>;

/**
 * Where a capture stands, read from the recorder's own state files rather than
 * held in this process — so a reopened panel finds a recording still running.
 */
export const traceSiftCaptureSchema = z.object({
  apiVersion: z.literal(1),
  /** The Chrome `record launch` left open, when one is still alive. */
  browser: z.object({ url: z.string() }).optional(),
  /**
   * The React Native app a running recording is attached to. Only an RN
   * recording writes a target label, so its presence is what tells a reopened
   * panel which of the two sources is live.
   */
  app: z.object({ targetLabel: z.string() }).optional(),
  recording: z.boolean(),
  /** The trace the last recording wrote, which the panel analyzes by path. */
  capture: z.object({
    path: z.string(), sizeBytes: z.number().nonnegative(), eventCount: z.number().nonnegative(),
  }).optional(),
});
export type TraceSiftCapture = z.infer<typeof traceSiftCaptureSchema>;

const finite = z.number().finite().nonnegative();
const taskCulpritSchema = z.object({
  name: z.string(), location: z.string().optional(), frameClass: z.string(), selfMs: finite,
  totalMs: finite, invocations: z.number().int().nonnegative(), longestCallMs: finite,
  shapeText: z.string(), nodeId: z.string(), callers: z.array(z.string()), reachedVia: z.array(z.string()), hotPath: z.array(z.string()),
});
const frameClass = z.string();
/** A function one band below a boundary frame, or one that burned its time; the card draws both with one shape. */
const measuredFrameSchema = z.object({
  name: z.string(), location: z.string().optional(), frameClass, nodeId: z.string(),
  totalMs: finite, selfMs: finite, invocations: z.number().int().nonnegative(),
  longestCallMs: finite, shapeText: z.string(),
});
const boundaryCulpritSchema = measuredFrameSchema.extend({ callers: z.array(z.string()) });
/** A feature of the user's own that the task entered. Carried whole so the card derives slices exactly as the web app does. */
const boundaryFrameSchema = z.object({
  name: z.string(), location: z.string().optional(), nodeId: z.string(),
  totalMs: finite, selfMs: finite, invocations: z.number().int().nonnegative(),
  longestCallMs: finite, shapeText: z.string(),
  culprits: z.array(boundaryCulpritSchema).default([]),
  inside: z.array(measuredFrameSchema).optional(),
});
export type TraceSiftBoundaryFrame = z.infer<typeof boundaryFrameSchema>;
export type TraceSiftBoundaryCulprit = z.infer<typeof boundaryCulpritSchema>;
export type TraceSiftMeasuredFrame = z.infer<typeof measuredFrameSchema>;

export const traceSiftTaskCardSchema = z.object({
  id: z.string().min(1), taskIndex: z.number().int().nonnegative(), startMs: finite, durationMs: finite,
  boundaries: z.string(), headline: z.string().min(1), pathline: z.string().optional(), shapeline: z.string().optional(),
  percentOfProfile: finite, boundaryFrames: z.array(boundaryFrameSchema), boundaryTailCount: z.number().int().nonnegative(),
  boundaryTailMs: finite, outsideBoundariesMs: finite, culprits: z.array(taskCulpritSchema),
  subtreeFunctionCount: z.number().int().nonnegative(), confidence: z.enum(["ok", "low"]),
});

const reactCulpritSchema = z.object({
  componentId: z.string(), component: z.string(), componentClass: z.string(), selfMs: finite,
  percentOfCommit: finite, cause: z.string(), changedProps: z.array(z.string()), changedHooks: z.array(z.string()),
  compiledWithForget: z.boolean(), sourceHint: z.string().nullable(), path: z.array(z.string()), evidence: z.string(),
});
export const traceSiftReactCardSchema = z.object({
  id: z.string().min(1), rootId: z.number().int(), commitIndex: z.number().int().nonnegative(), startMs: finite,
  durationMs: finite, percentOfRender: finite, severity: z.enum(["low", "medium", "high"]), shape: z.string(),
  headline: z.string().min(1), pathline: z.string().optional(), shapeline: z.string(), causeline: z.string(),
  updaterline: z.string().optional(), effectline: z.string().optional(), renderedCount: z.number().int().nonnegative(),
  summedSelfMs: finite, unattributedMs: finite, effectDurationMs: finite, passiveEffectDurationMs: finite,
  priority: z.string().nullable(), updaters: z.array(z.string()), culprits: z.array(reactCulpritSchema),
  culpritTailCount: z.number().int().nonnegative(), culpritTailMs: finite, causes: z.array(z.object({ cause: z.string(), count: z.number().int().nonnegative(), selfMs: finite })),
  wasted: z.object({ count: z.number().int().nonnegative(), selfMs: finite }).nullable(), confidence: z.enum(["ok", "low"]),
});

const base = { apiVersion: z.literal(1), analysisId: z.string().min(1), title: z.string() };
const cpuSummarySchema = z.object({
  totalMs: finite, callCountIsExact: z.boolean(), omittedTaskCount: z.number().int().nonnegative().optional(),
  // Tasks in the whole recording, for the header's "3 long tasks of 870". Optional: older TraceSift omits it and the clause is dropped.
  taskCount: z.number().int().nonnegative().optional(),
  noLongTasks: z.boolean().optional(), profilerOverheadMs: finite.optional(),
});
const reactSummarySchema = z.object({
  rootCount: z.number().int().nonnegative(), commitCount: z.number().int().nonnegative(),
  totalCommitRenderDurationMs: finite, peakCommitDurationMs: finite, commitsOverBudget: z.number().int().nonnegative(),
  omittedEvidenceCommitCount: z.number().int().nonnegative(),
});
export const traceSiftAnalysisSchema = z.discriminatedUnion("profileType", [
  z.object({ ...base, profileType: z.literal("cpu"), summary: cpuSummarySchema, cards: z.array(traceSiftTaskCardSchema) }),
  z.object({ ...base, profileType: z.literal("react"), summary: reactSummarySchema, cards: z.array(traceSiftReactCardSchema) }),
]);
export type TraceSiftAnalysis = z.infer<typeof traceSiftAnalysisSchema>;

export const traceSiftRestoreSchema = z.discriminatedUnion("restored", [
  z.object({ apiVersion: z.literal(1), restored: z.literal(false) }),
  z.object({ apiVersion: z.literal(1), restored: z.literal(true), analysis: traceSiftAnalysisSchema }),
]);

export const traceSiftHandoffSchema = z.object({ apiVersion: z.literal(1), handoff: z.string().min(1).max(1_000_000) });

/**
 * The full card handed to the explorer. Bulk fields stay `unknown`: megabytes
 * only the explorer draws. Shapes match the package's own handoff types.
 */
export type TraceSiftTaskHandoff = { analysisId: string; profileTitle: string; totalMs: number; card: Record<string, unknown> };
/** Every commit timeline of one React analysis, plus the cards that label them. */
export type TraceSiftReactHandoff = { analysisId: string; profileTitle: string; explore: unknown; cards: unknown[] };

export type TraceSiftTaskCard = z.infer<typeof traceSiftTaskCardSchema>;
export type TraceSiftReactCard = z.infer<typeof traceSiftReactCardSchema>;
export type TraceSiftCpuAnalysis = Extract<TraceSiftAnalysis, { profileType: "cpu" }>;
