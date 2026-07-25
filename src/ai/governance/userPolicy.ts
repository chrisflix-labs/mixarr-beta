import { z } from "zod";
import { AI_REQUEST_LIMIT_MODES, MAXIMUM_AI_REQUEST_LIMIT, validateRequestLimitConfiguration } from "./requestLimits";

const optionalDecimal = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? value.trim() : value, z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d{1,6})?$/, "Enter a non-negative amount with no more than 6 decimal places."), z.null()]).optional());
const optionalInteger = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? Number(value.trim()) : value, z.number().int("Enter a whole number.").nonnegative("Enter zero or a positive number.").nullable().optional());
// Request counts are throttles, so zero is rejected instead of stored: an
// ambiguous zero previously blocked every request with no way to clear it.
const optionalRequestCount = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? Number(value.trim()) : value, z.number().int("Enter a whole number.").min(1, "Enter 1 or more requests, or choose Unlimited. Zero is not a valid limit.").max(MAXIMUM_AI_REQUEST_LIMIT, `Enter ${MAXIMUM_AI_REQUEST_LIMIT.toLocaleString("en-US")} or fewer requests.`).nullable().optional());

export const aiUserPolicySchema = z.object({
  scope: z.literal("user"),
  userId: z.string().trim().uuid("Enter a valid Mixarr user UUID."),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  dailyCostLimit: optionalDecimal,
  monthlyCostLimit: optionalDecimal,
  dailyRequestLimitMode: z.enum(AI_REQUEST_LIMIT_MODES).default("INHERIT"),
  dailyRequestLimit: optionalRequestCount,
  monthlyRequestLimit: optionalRequestCount,
  maximumInputTokens: optionalInteger,
  maximumOutputTokens: optionalInteger,
  maximumCombinedTokens: optionalInteger,
  allowedPrivacyModes: z.array(z.string()).optional(),
  allowedProviderIds: z.array(z.string().uuid()).optional(),
  allowedModelTiers: z.array(z.string()).optional(),
  paidProvidersAllowed: z.boolean().nullable().optional(),
  backgroundRequestsAllowed: z.boolean().nullable().optional(),
  reason: z.string().max(1000).optional()
}).superRefine((value, context) => {
  const decision = validateRequestLimitConfiguration({ mode: value.dailyRequestLimitMode, limit: value.dailyRequestLimit });
  if (!decision.ok) context.addIssue({ code: z.ZodIssueCode.custom, path: [decision.field === "mode" ? "dailyRequestLimitMode" : "dailyRequestLimit"], message: decision.error });
});

export function fieldErrorsFromZod(error: z.ZodError) {
  const aliases: Record<string, string> = { userId: "user_uuid", dailyCostLimit: "daily_cost_limit", monthlyCostLimit: "monthly_cost_limit", dailyRequestLimitMode: "daily_requests_mode", dailyRequestLimit: "daily_requests", monthlyRequestLimit: "monthly_requests", paidProvidersAllowed: "permit_paid_providers", backgroundRequestsAllowed: "permit_background_requests" };
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = String(issue.path[0] || "form");
    fieldErrors[aliases[path] || path] ||= issue.message;
  }
  return fieldErrors;
}
