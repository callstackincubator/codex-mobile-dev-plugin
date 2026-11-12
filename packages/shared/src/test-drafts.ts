import { z } from "zod";
import type { RecordedStep } from "./test-recording.ts";

/**
 * A recording that has not reached the project yet.
 *
 * The recorder holds one flow at a time and holds it in the panel document, which the host
 * rebuilds whenever the user looks at something else. Until now that meant a flow the user had
 * not saved — or one their agent recorded while they were reading the chat — was simply gone when
 * they came back. A draft is that flow written down: the steps as data, not the emitted source,
 * so it comes back editable rather than as a file the panel cannot take apart again.
 *
 * Drafts are the plugin's own state, not the project's: nothing is ever written into the user's
 * repository until they press Save. One is deleted when its flow is saved, and when the user says
 * so. See `packages/core/src/testing-drafts.ts`.
 */

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

const namedSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("testId"), testId: z.string().max(1024) }).strict(),
  z.object({ kind: z.literal("role"), role: z.string().max(256), name: z.string().max(1024) }).strict(),
  z.object({ kind: z.literal("placeholder"), placeholder: z.string().max(1024) }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().max(1024) }).strict(),
  z.object({ kind: z.literal("label"), label: z.string().max(1024) }).strict(),
]);

export const recordedSelectorSchema = z.union([
  namedSelectorSchema,
  z.object({ kind: z.literal("point"), point }).strict(),
  z.object({
    kind: z.literal("nth"),
    inner: namedSelectorSchema,
    index: z.number().int().min(0).max(4096),
    matches: z.number().int().min(0).max(4096),
  }).strict(),
]);

const stepTargetSchema = z.object({
  role: z.string().max(256).optional(),
  placeholder: z.string().max(1024).optional(),
  label: z.string().max(1024).optional(),
  text: z.string().max(1024).optional(),
  value: z.string().max(4096).optional(),
}).strict();

const pinnedStepKindSchema = z.enum([
  "tap", "doubleTap", "longPress", "fill", "scrollUntilVisible",
  "assertVisible", "assertNotVisible", "assertText", "assertContainsText", "assertValue",
  "assertEnabled", "assertDisabled", "assertSelected", "swipe",
]);

const visionSchema = z.union([z.boolean(), z.literal("only")]);
const instruction = z.string().max(4096);
const stepId = z.string().min(1).max(128);
const stepLabel = z.string().max(1024);

export const recordedStepSchema = z.union([
  z.object({
    id: stepId,
    label: stepLabel,
    kind: pinnedStepKindSchema,
    selector: recordedSelectorSchema,
    value: z.string().max(4096).optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    ambiguous: z.boolean().optional(),
    anchor: recordedSelectorSchema.optional(),
    target: stepTargetSchema.optional(),
  }).strict(),
  z.object({
    id: stepId, label: stepLabel, kind: z.literal("agentAct"), instruction,
    params: z.record(z.string().max(256), z.string().max(4096)).optional(),
  }).strict(),
  z.object({ id: stepId, label: stepLabel, kind: z.literal("agentAssert"), instruction, vision: visionSchema.optional() }).strict(),
  z.object({ id: stepId, label: stepLabel, kind: z.literal("agentWaitFor"), instruction, vision: visionSchema.optional() }).strict(),
]);

/** The most steps one draft may hold, well past the "a long flow is two tests" guidance. */
export const MAX_DRAFT_STEPS = 200;

export const testDraftIdSchema = z.uuid();

export const testDraftSchema = z.object({
  schemaVersion: z.literal(1),
  id: testDraftIdSchema,
  /** The project the flow was recorded against, so the panel only lists its own drafts. */
  projectPath: z.string().min(1).max(4096),
  title: z.string().max(160),
  /** The file name the user typed under `tests/`, or "" to derive it from the title on save. */
  fileName: z.string().max(256),
  /** Who recorded it, for the row's label. */
  origin: z.enum(["user", "agent"]),
  steps: z.array(recordedStepSchema).max(MAX_DRAFT_STEPS),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export type TestDraft = Omit<z.infer<typeof testDraftSchema>, "steps"> & { steps: RecordedStep[] };

/** What a draft row needs: everything but the steps, which only the opened draft reads. */
export type TestDraftSummary = Omit<TestDraft, "steps"> & { stepCount: number };

export function draftSummary(draft: TestDraft): TestDraftSummary {
  const { steps, ...rest } = draft;
  return { ...rest, stepCount: steps.length };
}

/** What a draft reads as in the list when it has no title of its own. */
export function draftLabel(draft: Pick<TestDraft, "title">): string {
  return draft.title.trim() || "Untitled flow";
}
