import { z } from "zod";

export class SupplierRefreshInputError extends Error {
  constructor(message: string, readonly status: 400 | 422 = 400) {
    super(message);
  }
}

const optionsSchema = z.object({
  dryRun: z.boolean().default(false),
  sourceSkuIds: z.array(z.string().trim().min(1).max(100)).min(1).max(1000).optional(),
}).strict().superRefine((options, context) => {
  if (options.sourceSkuIds && !options.dryRun) {
    context.addIssue({ code: "custom", message: "sourceSkuIds exige dryRun:true." });
  }
  if (options.sourceSkuIds && new Set(options.sourceSkuIds).size !== options.sourceSkuIds.length) {
    context.addIssue({ code: "custom", message: "sourceSkuIds não pode conter IDs duplicados." });
  }
});

export function parseSupplierRefreshOptions(value: unknown) {
  const parsed = optionsSchema.safeParse(value);
  if (!parsed.success) {
    throw new SupplierRefreshInputError(parsed.error.issues.map((issue) => issue.message).join(" "));
  }
  return parsed.data;
}
