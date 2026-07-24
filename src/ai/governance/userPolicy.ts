import { z } from "zod";

const optionalDecimal = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? value.trim() : value, z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d{1,6})?$/, "Enter a non-negative amount with no more than 6 decimal places."), z.null()]).optional());
const optionalInteger = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? Number(value.trim()) : value, z.number().int("Enter a whole number.").nonnegative("Enter zero or a positive number.").nullable().optional());

export const aiUserPolicySchema = z.object({
  scope: z.literal("user"),
  userId: z.string().trim().uuid("Enter a valid Mixarr user UUID."),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  dailyCostLimit: optionalDecimal,
  monthlyCostLimit: optionalDecimal,
  perRequestCostLimitEnabled: z.boolean().optional(),
  perRequestCostLimitUsd: optionalDecimal,
  dailyRequestLimit: optionalInteger,
  monthlyRequestLimit: optionalInteger,
  maximumInputTokens: optionalInteger,
  maximumOutputTokens: optionalInteger,
  maximumCombinedTokens: optionalInteger,
  allowedPrivacyModes: z.array(z.string()).optional(),
  allowedProviderIds: z.array(z.string().uuid()).optional(),
  allowedModelTiers: z.array(z.string()).optional(),
  paidProvidersAllowed: z.boolean().nullable().optional(),
  backgroundRequestsAllowed: z.boolean().nullable().optional(),
  reason: z.string().max(1000).optional()
}).superRefine((input, context) => {
  if (input.perRequestCostLimitEnabled === true && (input.perRequestCostLimitUsd == null || !Number.isFinite(Number(input.perRequestCostLimitUsd)) || Number(input.perRequestCostLimitUsd) <= 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["perRequestCostLimitUsd"], message: "Enter a per-request cost limit greater than zero when enforcement is enabled." });
  }
});

export function fieldErrorsFromZod(error: z.ZodError) {
  const aliases: Record<string, string> = { userId: "user_uuid", dailyCostLimit: "daily_cost_limit", monthlyCostLimit: "monthly_cost_limit", perRequestCostLimitUsd: "per_request_cost_limit_usd", dailyRequestLimit: "daily_requests", monthlyRequestLimit: "monthly_requests", paidProvidersAllowed: "permit_paid_providers", backgroundRequestsAllowed: "permit_background_requests" };
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = String(issue.path[0] || "form");
    fieldErrors[aliases[path] || path] ||= issue.message;
  }
  return fieldErrors;
}
