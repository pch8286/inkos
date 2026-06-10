import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);
const ChapterNumberSchema = z.number().int().positive();
const TimestampSchema = z.string().datetime();

export const ProjectStoryModeSchema = z.enum(["draft", "serialized"]);
export type ProjectStoryMode = z.infer<typeof ProjectStoryModeSchema>;

export const ChapterPublicationStatusSchema = z.enum(["draft", "locked", "published"]);
export type ChapterPublicationStatus = z.infer<typeof ChapterPublicationStatusSchema>;

export const WorldPressureTypeSchema = z.enum(["faction", "character", "location", "hook", "environment"]);
export type WorldPressureType = z.infer<typeof WorldPressureTypeSchema>;

export const PressureLevelSchema = z.enum(["low", "medium", "high"]);
export type PressureLevel = z.infer<typeof PressureLevelSchema>;

export const ProtagonistVisibilitySchema = z.enum(["yes", "no", "partial"]);
export type ProtagonistVisibility = z.infer<typeof ProtagonistVisibilitySchema>;

export const AdaptiveTickKindSchema = z.enum([
  "protagonist_action",
  "protagonist_inaction",
  "elapsed_time",
  "direction_override",
]);
export type AdaptiveTickKind = z.infer<typeof AdaptiveTickKindSchema>;

export const MovementRelevanceSchema = z.enum(["low", "medium", "high"]);
export type MovementRelevance = z.infer<typeof MovementRelevanceSchema>;

export const MovementVisibilitySchema = z.enum(["observed_now", "rumor", "hidden", "delayed"]);
export type MovementVisibility = z.infer<typeof MovementVisibilitySchema>;

export const MovementRiskSchema = z.enum(["low", "medium", "high"]);
export type MovementRisk = z.infer<typeof MovementRiskSchema>;

export const MovementConflictLevelSchema = z.enum(["none", "minor", "major"]);
export type MovementConflictLevel = z.infer<typeof MovementConflictLevelSchema>;

export const MovementCandidateStatusSchema = z.enum(["candidate", "approved", "rejected", "hold"]);
export type MovementCandidateStatus = z.infer<typeof MovementCandidateStatusSchema>;

export const ConflictPolicySchema = z.enum([
  "draft_rewrite_allowed",
  "serialized_forward_only",
  "edition_retcon_required",
]);
export type ConflictPolicy = z.infer<typeof ConflictPolicySchema>;

export const RepairStrategySchema = z.enum([
  "forward_bend",
  "soft_reveal",
  "continuity_patch",
  "local_rewrite",
  "cascade_retcon",
  "edition_retcon",
]);
export type RepairStrategy = z.infer<typeof RepairStrategySchema>;

export const StorySpineSchema = z.object({
  protagonistId: NonEmptyStringSchema,
  currentGoal: NonEmptyStringSchema,
  currentQuestion: NonEmptyStringSchema,
  emotionalState: z.array(NonEmptyStringSchema).default([]),
  activeChoices: z.array(NonEmptyStringSchema).default([]),
  constraints: z.array(NonEmptyStringSchema).default([]),
}).strict();

export type StorySpine = z.infer<typeof StorySpineSchema>;

export const WorldPressureSchema = z.object({
  id: NonEmptyStringSchema,
  type: WorldPressureTypeSchema,
  label: NonEmptyStringSchema,
  currentMotion: NonEmptyStringSchema,
  pressureLevel: PressureLevelSchema.default("medium"),
  visibleToProtagonist: ProtagonistVisibilitySchema.default("partial"),
}).strict();

export type WorldPressure = z.infer<typeof WorldPressureSchema>;

export const MovementCandidateSchema = z.object({
  id: NonEmptyStringSchema,
  sourceTickId: NonEmptyStringSchema,
  text: NonEmptyStringSchema,
  relevance: MovementRelevanceSchema.default("medium"),
  visibility: MovementVisibilitySchema.default("delayed"),
  risk: MovementRiskSchema.default("medium"),
  conflictLevel: MovementConflictLevelSchema.default("none"),
  status: MovementCandidateStatusSchema.default("candidate"),
  affectedChapters: z.array(ChapterNumberSchema).default([]),
  affectedStateKeys: z.array(NonEmptyStringSchema).default([]),
  repairStrategy: RepairStrategySchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export type MovementCandidate = z.infer<typeof MovementCandidateSchema>;

const AdaptiveTickInputBaseSchema = z.object({
  id: NonEmptyStringSchema,
  bookId: NonEmptyStringSchema,
  chapter: ChapterNumberSchema,
  kind: AdaptiveTickKindSchema,
  protagonistAction: NonEmptyStringSchema.optional(),
  protagonistInaction: NonEmptyStringSchema.optional(),
  elapsedTime: NonEmptyStringSchema.optional(),
  userDirection: NonEmptyStringSchema.optional(),
  storySpine: StorySpineSchema,
  worldPressures: z.array(WorldPressureSchema).default([]),
  createdAt: TimestampSchema,
}).strict();

export const AdaptiveTickInputSchema = AdaptiveTickInputBaseSchema.superRefine((value, ctx) => {
  const causeFields = {
    protagonist_action: "protagonistAction",
    protagonist_inaction: "protagonistInaction",
    elapsed_time: "elapsedTime",
    direction_override: "userDirection",
  } as const;
  const expectedField = causeFields[value.kind];

  if (!value[expectedField]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.kind} requires ${expectedField}.`,
      path: [expectedField],
    });
  }

  for (const field of Object.values(causeFields)) {
    if (field === expectedField || !value[field]) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${field} is not valid for ${value.kind}.`,
      path: [field],
    });
  }
});

export type AdaptiveTickInput = z.infer<typeof AdaptiveTickInputSchema>;

export const AdaptiveTickSchema = AdaptiveTickInputBaseSchema.extend({
  candidates: z.array(MovementCandidateSchema).default([]),
}).strict().superRefine((value, ctx) => {
  const { candidates: _candidates, ...input } = value;
  const parsed = AdaptiveTickInputSchema.safeParse(input);
  if (parsed.success) return;

  for (const issue of parsed.error.issues) {
    ctx.addIssue(issue);
  }
});

export type AdaptiveTick = z.infer<typeof AdaptiveTickSchema>;

export const ChapterStatusRecordSchema = z.object({
  chapter: ChapterNumberSchema,
  status: ChapterPublicationStatusSchema.default("draft"),
  updatedAt: TimestampSchema,
}).strict();

export type ChapterStatusRecord = z.infer<typeof ChapterStatusRecordSchema>;

export const ImpactReportSchema = z.object({
  movementCandidateId: NonEmptyStringSchema,
  affectedChapters: z.array(ChapterNumberSchema).default([]),
  affectedStateKeys: z.array(NonEmptyStringSchema).default([]),
  conflictLevel: MovementConflictLevelSchema.default("none"),
  repairStrategy: RepairStrategySchema.optional(),
  notes: z.array(NonEmptyStringSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export type ImpactReport = z.infer<typeof ImpactReportSchema>;

export const SceneContractSchema = z.object({
  id: NonEmptyStringSchema,
  chapter: ChapterNumberSchema,
  sourceTickIds: z.array(NonEmptyStringSchema).default([]),
  pov: NonEmptyStringSchema,
  location: NonEmptyStringSchema,
  sceneGoal: z.array(NonEmptyStringSchema).default([]),
  outlineNode: NonEmptyStringSchema.optional(),
  mustInclude: z.array(NonEmptyStringSchema).default([]),
  mustAvoid: z.array(NonEmptyStringSchema).default([]),
  styleEmphasis: z.array(NonEmptyStringSchema).default([]),
  movementCandidateIds: z.array(NonEmptyStringSchema).default([]),
  endingState: z.array(NonEmptyStringSchema).default([]),
  conflictPolicy: ConflictPolicySchema.default("draft_rewrite_allowed"),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export type SceneContract = z.infer<typeof SceneContractSchema>;
