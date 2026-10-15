import { z } from "zod";
import { PLUGIN_VERSION } from "./version.ts";

export const TRACESIFT_URI = `ui://mobile-dev/${PLUGIN_VERSION}/tracesift.html`;
export const traceSiftProfileTypeSchema = z.enum(["auto", "cpu", "react"]);
export type TraceSiftProfileType = z.infer<typeof traceSiftProfileTypeSchema>;
export const traceSiftProfileInputSchema = z.object({
  path: z.string().min(1).max(16_384), profileType: traceSiftProfileTypeSchema.default("auto"),
});

const finite = z.number().finite().nonnegative();
const taskCulpritSchema = z.object({
  name: z.string(), location: z.string().optional(), frameClass: z.string(), selfMs: finite,
  totalMs: finite, invocations: z.number().int().nonnegative(), longestCallMs: finite,
  shapeText: z.string(), nodeId: z.string(), callers: z.array(z.string()), reachedVia: z.array(z.string()), hotPath: z.array(z.string()),
});
const frameClass = z.string();
/**
 * A function named one band below a boundary frame, or one that burned its
 * time. Both carry the same figures, so the card draws them with one shape.
 */
const measuredFrameSchema = z.object({
  name: z.string(), location: z.string().optional(), frameClass, nodeId: z.string(),
  totalMs: finite, selfMs: finite, invocations: z.number().int().nonnegative(),
  longestCallMs: finite, shapeText: z.string(),
});
const boundaryCulpritSchema = measuredFrameSchema.extend({ callers: z.array(z.string()) });
/**
 * A feature of the user's own that the task entered, with everything the
 * contribution chart divides it by. The analyze response carries these whole:
 * the slices, the legend and the drill-down are all computed from them in the
 * card, exactly as the web app computes them, so the two cannot drift.
 */
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
  // How many tasks the recording held in all, which the header's "3 long tasks
  // of 870" needs and no card carries. Optional: a TraceSift older than the
  // field answers without it, and the header drops that clause.
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

export type TraceSiftTaskCard = z.infer<typeof traceSiftTaskCardSchema>;
export type TraceSiftReactCard = z.infer<typeof traceSiftReactCardSchema>;
export type TraceSiftCpuAnalysis = Extract<TraceSiftAnalysis, { profileType: "cpu" }>;
