import { z } from "zod";

export const StructuralGateSeveritySchema = z.enum(["critical", "soft"]);
export type StructuralGateSeverity = z.infer<typeof StructuralGateSeveritySchema>;

export const StructuralGateFindingBaseSchema = z.object({
  severity: StructuralGateSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  evidence: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
}).strict();

export type StructuralGateFindingBase = z.infer<typeof StructuralGateFindingBaseSchema>;

export const StructuralGateCriticalFindingSchema = StructuralGateFindingBaseSchema.extend({
  severity: z.literal("critical"),
}).strict();

export type StructuralGateCriticalFinding = z.infer<typeof StructuralGateCriticalFindingSchema>;

export const StructuralGateSoftFindingSchema = StructuralGateFindingBaseSchema.extend({
  severity: z.literal("soft"),
}).strict();

export type StructuralGateSoftFinding = z.infer<typeof StructuralGateSoftFindingSchema>;

export const StructuralGateResultSchema = z.object({
  passed: z.boolean(),
  summary: z.string().min(1),
  criticalFindings: z.array(StructuralGateCriticalFindingSchema),
  softFindings: z.array(StructuralGateSoftFindingSchema),
}).strict().superRefine((value, ctx) => {
  const shouldPass = value.criticalFindings.length === 0;
  if (value.passed !== shouldPass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: shouldPass
        ? "Structural gate must pass when no critical findings are present."
        : "Structural gate must fail when critical findings are present.",
      path: ["passed"],
    });
  }
});

export type StructuralGateResult = z.infer<typeof StructuralGateResultSchema>;
