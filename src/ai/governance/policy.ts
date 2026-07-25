import { AiError } from "../errors";

export const AI_PRIVACY_MODES = ["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"] as const;
export type AiPrivacyMode = typeof AI_PRIVACY_MODES[number];
export type AiMetadataRecord = Record<string, unknown>;

export const DEFAULT_METADATA_ALLOWLIST = ["artist", "album", "title", "album_artist", "genres", "release_year", "track_number", "disc_number", "duration", "bpm", "musical_key", "energy", "mood", "danceability", "loudness", "instrumentalness", "acousticness", "popularity", "explicit", "existing_tags"] as const;
export const KNOWN_METADATA_FIELDS = new Set([...DEFAULT_METADATA_ALLOWLIST, "user_rating", "play_count", "last_played", "date_added", "playlist_position", "valence"]);
const NEVER_TRANSMIT = new Set(["username", "email", "plex_account_id", "playlist_owner", "household_member", "file_path", "network_path", "server_hostname", "ip_address", "api_key", "api_token", "provider_credentials", "database_id", "rating_key", "plex_rating_key", "access_token", "library_storage_location", "private_notes", "raw_file", "authentication"]);
const IDENTIFYING_MUSIC_FIELDS = new Set(["artist", "album", "title", "album_artist", "playlist_name", "description"]);

export type PrivacyReport = {
  privacy_mode: AiPrivacyMode;
  included_fields: string[];
  transformed_fields: string[];
  blocked_fields: string[];
  unknown_fields: string[];
  external_transmission: boolean;
  warning?: string;
};

export type PrivacyPolicyInput = {
  mode: AiPrivacyMode;
  providerLocation: "LOCAL" | "REMOTE" | "USER_CLASSIFIED" | "UNKNOWN";
  records: AiMetadataRecord[];
  allowlist?: readonly string[];
  allowUnknownLocal?: boolean;
  fullMetadataAcknowledged?: boolean;
  granularity?: "STRICT" | "BALANCED" | "MINIMAL";
  yearBandSize?: number;
  bpmBandSize?: number;
};

function normalizedKey(value: string) { return value.trim().toLowerCase().replace(/[\s-]+/g, "_"); }
function numberBand(value: unknown, width: number, suffix = "") {
  const numeric = Number(value); if (!Number.isFinite(numeric)) return undefined;
  const start = Math.floor(numeric / width) * width; return `${start}-${start + width - 1}${suffix}`;
}
function generalizedGenre(value: unknown) {
  const source = Array.isArray(value) ? value.map(String) : [String(value || "")];
  const map: Record<string, string> = { trip_hop: "electronic", hip_hop: "hip-hop", synthwave: "electronic", house: "electronic", techno: "electronic", metalcore: "metal", indie_rock: "rock", alt_rock: "rock" };
  return source.filter(Boolean).map((genre) => map[normalizedKey(genre)] || genre.toLowerCase());
}
function anonymousValue(key: string, value: unknown, input: PrivacyPolicyInput) {
  if (IDENTIFYING_MUSIC_FIELDS.has(key)) return undefined;
  if (key === "release_year") return numberBand(value, Math.max(5, input.yearBandSize || 10), " era");
  if (key === "bpm") return numberBand(value, Math.max(5, input.bpmBandSize || 10), " BPM");
  if (key === "popularity" || key === "play_count" || key === "user_rating") return numberBand(value, input.granularity === "MINIMAL" ? 10 : 25);
  if (key === "genres") return generalizedGenre(value);
  return value;
}

export function strictestPrivacyMode(...modes: Array<AiPrivacyMode | null | undefined>): AiPrivacyMode {
  const rank: Record<AiPrivacyMode, number> = { LOCAL_ONLY: 0, ANONYMOUS_METADATA: 1, METADATA_LIMITED: 2, FULL_METADATA: 3 };
  let strictest: AiPrivacyMode = "FULL_METADATA"; for (const mode of modes) if (mode && rank[mode] < rank[strictest]) strictest = mode; return strictest;
}

export function applyMetadataPrivacyPolicy(input: PrivacyPolicyInput) {
  const external = input.providerLocation !== "LOCAL";
  if (input.mode === "LOCAL_ONLY" && external) throw new AiError("AI_EXTERNAL_PROVIDER_BLOCKED");
  if (input.mode === "FULL_METADATA" && external && !input.fullMetadataAcknowledged) throw new AiError("AI_PRIVACY_POLICY_BLOCKED", undefined, 409, undefined, { reason: "FULL_METADATA_ACKNOWLEDGMENT_REQUIRED" });
  const allowlist = new Set((input.allowlist || DEFAULT_METADATA_ALLOWLIST).map(normalizedKey));
  const included = new Set<string>(); const transformed = new Set<string>(); const blocked = new Set<string>(); const unknown = new Set<string>();
  const payload = input.records.map((record) => {
    const safe: AiMetadataRecord = {};
    for (const [rawKey, rawValue] of Object.entries(record)) {
      const key = normalizedKey(rawKey); const isUnknown = !KNOWN_METADATA_FIELDS.has(key) && !NEVER_TRANSMIT.has(key) && !IDENTIFYING_MUSIC_FIELDS.has(key) && key !== "playlist_name" && key !== "description";
      if (isUnknown) unknown.add(key);
      const never = NEVER_TRANSMIT.has(key); const unknownBlocked = isUnknown && (external || !input.allowUnknownLocal);
      const allowlistBlocked = external && input.mode !== "FULL_METADATA" && !allowlist.has(key);
      if (never || unknownBlocked || allowlistBlocked) { blocked.add(key); continue; }
      if (input.mode === "ANONYMOUS_METADATA" && external) {
        const value = anonymousValue(key, rawValue, input);
        if (value === undefined) { blocked.add(key); continue; }
        if (value !== rawValue) transformed.add(key); else included.add(key); safe[key] = value; continue;
      }
      included.add(key); safe[key] = rawValue;
    }
    return safe;
  });
  const report: PrivacyReport = { privacy_mode: input.mode, included_fields: Array.from(included).sort(), transformed_fields: Array.from(transformed).sort(), blocked_fields: Array.from(blocked).sort(), unknown_fields: Array.from(unknown).sort(), external_transmission: external, ...(input.mode === "ANONYMOUS_METADATA" ? { warning: "Attribute combinations may still identify a recording; this mode is not mathematical anonymity." } : {}) };
  return { payload, report };
}

export function estimateTokens(value: string) {
  if (!value) return 0;
  const bytes = Buffer.byteLength(value, "utf8"); const words = value.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(Math.max(bytes / 4, words * 1.25)));
}

export type TokenLimits = { maximumInputTokens?: number | null; maximumOutputTokens?: number | null; maximumCombinedTokens?: number | null };
const strictPositive = (values: Array<number | null | undefined>, fallback: number) => Math.min(...values.filter((value): value is number => value != null && value > 0).concat(fallback));
export function resolveEffectiveTokenLimits(scopes: TokenLimits[], requestOutputTokens?: number) {
  const maximumInputTokens = strictPositive(scopes.map((scope) => scope.maximumInputTokens), Number.MAX_SAFE_INTEGER);
  const maximumOutputTokens = strictPositive([...scopes.map((scope) => scope.maximumOutputTokens), requestOutputTokens], Number.MAX_SAFE_INTEGER);
  const maximumCombinedTokens = strictPositive(scopes.map((scope) => scope.maximumCombinedTokens), Number.MAX_SAFE_INTEGER);
  return { maximumInputTokens, maximumOutputTokens, maximumCombinedTokens };
}

export function validatePromptLimits(input: { text: string; messageCount: number; metadataRecordCount: number; estimatedInputTokens?: number; limits: { maximumPromptCharacters: number; maximumPromptBytes: number; maximumContextMessages: number; maximumMetadataRecords: number } & TokenLimits; requestedOutputTokens?: number; tokenScopes?: TokenLimits[] }) {
  const characters = input.text.length; const bytes = Buffer.byteLength(input.text, "utf8"); const estimatedInputTokens = input.estimatedInputTokens ?? estimateTokens(input.text);
  if (characters > input.limits.maximumPromptCharacters || bytes > input.limits.maximumPromptBytes || input.messageCount > input.limits.maximumContextMessages || input.metadataRecordCount > input.limits.maximumMetadataRecords) throw new AiError("AI_PROMPT_TOO_LARGE", undefined, 409, undefined, { characters, bytes, message_count: input.messageCount, metadata_records: input.metadataRecordCount });
  const effective = resolveEffectiveTokenLimits([input.limits, ...(input.tokenScopes || [])], input.requestedOutputTokens);
  if (estimatedInputTokens > effective.maximumInputTokens || estimatedInputTokens >= effective.maximumCombinedTokens) throw new AiError("AI_TOKEN_LIMIT_EXCEEDED", undefined, 409, undefined, { estimated_input_tokens: estimatedInputTokens, effective_limits: effective });
  const maxOutputTokens = Math.max(0, Math.min(effective.maximumOutputTokens, effective.maximumCombinedTokens - estimatedInputTokens));
  if (maxOutputTokens < 1) throw new AiError("AI_RESPONSE_LIMIT_INVALID");
  return { characters, bytes, estimatedInputTokens, maxOutputTokens, effectiveLimits: effective, clamped: input.requestedOutputTokens != null && maxOutputTokens < input.requestedOutputTokens };
}

export const AI_CURRENCY_MICROS = 1_000_000;

export function currencyMicros(value: string | number | null | undefined) {
  if (value == null || value === "") return null; const source = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(source)) throw new AiError("INVALID_REQUEST", "Pricing values must be non-negative decimals.");
  const [whole, fraction = ""] = source.split("."); return Number(whole) * AI_CURRENCY_MICROS + Number((fraction + "000000").slice(0, 6));
}
function pricedTokens(tokens: number, perMillionMicros: number | null) { return perMillionMicros == null ? 0 : Math.ceil(Math.max(0, Math.ceil(tokens)) * perMillionMicros / AI_CURRENCY_MICROS); }
export function currencyFromMicros(micros: number) { return micros / AI_CURRENCY_MICROS; }

export type AiCostEvaluationScope = "request" | "daily" | "monthly" | "provider" | "user" | "retry";
export type AiCostEvaluation = {
  allowed: boolean;
  scope: AiCostEvaluationScope;
  estimatedCost: number;
  currentUsage: number;
  remainingBudget: number | null;
  limit: number | null;
  reasonCode: string | null;
};

export function evaluateCostLimit(input: { scope: AiCostEvaluationScope; estimatedCost: string | number; currentUsage?: string | number; limit?: string | number | null; reasonCode: string }): AiCostEvaluation {
  const estimatedMicros = currencyMicros(input.estimatedCost) || 0;
  const usageMicros = currencyMicros(input.currentUsage || 0) || 0;
  const limitMicros = currencyMicros(input.limit);
  const allowed = limitMicros == null || usageMicros + estimatedMicros <= limitMicros;
  return {
    allowed,
    scope: input.scope,
    estimatedCost: currencyFromMicros(estimatedMicros),
    currentUsage: currencyFromMicros(usageMicros),
    remainingBudget: limitMicros == null ? null : currencyFromMicros(Math.max(0, limitMicros - usageMicros)),
    limit: limitMicros == null ? null : currencyFromMicros(limitMicros),
    reasonCode: allowed ? null : input.reasonCode,
  };
}

export function evaluateRetryCost(input: { incrementalCost: string | number; retryNumber: number; retryLimit?: string | number | null; initialAttemptCost: string | number; cumulativeRequestLimit?: string | number | null }): AiCostEvaluation {
  const incrementalMicros = currencyMicros(input.incrementalCost) || 0;
  const retryNumber = Math.max(1, Math.floor(input.retryNumber));
  const cumulativeRetryMicros = incrementalMicros * retryNumber;
  const retryLimitMicros = currencyMicros(input.retryLimit);
  const cumulativeRequestMicros = (currencyMicros(input.initialAttemptCost) || 0) + cumulativeRetryMicros;
  const cumulativeRequestLimitMicros = currencyMicros(input.cumulativeRequestLimit);
  const retryAllowed = retryLimitMicros == null || cumulativeRetryMicros <= retryLimitMicros;
  const cumulativeAllowed = cumulativeRequestLimitMicros == null || cumulativeRequestMicros <= cumulativeRequestLimitMicros;
  const effectiveLimitMicros = !retryAllowed ? retryLimitMicros : cumulativeRequestLimitMicros;
  return {
    allowed: retryAllowed && cumulativeAllowed,
    scope: "retry",
    estimatedCost: currencyFromMicros(incrementalMicros),
    currentUsage: currencyFromMicros(cumulativeRetryMicros - incrementalMicros),
    remainingBudget: effectiveLimitMicros == null ? null : currencyFromMicros(Math.max(0, effectiveLimitMicros - (!retryAllowed ? cumulativeRetryMicros - incrementalMicros : cumulativeRequestMicros - incrementalMicros))),
    limit: effectiveLimitMicros == null ? null : currencyFromMicros(effectiveLimitMicros),
    reasonCode: retryAllowed && cumulativeAllowed ? null : "AI_RETRY_COST_LIMIT_EXCEEDED",
  };
}

export type PricingInput = { inputPricePerMillion?: string | number | null; outputPricePerMillion?: string | number | null; cachedInputPricePerMillion?: string | number | null; reasoningPricePerMillion?: string | number | null; fixedRequestCost?: string | number | null; currency?: string; pricingSource?: string | null; lastVerifiedAt?: Date | string | null; estimated?: boolean };
export function estimateRequestCost(input: { inputTokens: number; maximumOutputTokens: number; expectedOutputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number; retryAllowance?: number; pricing: PricingInput }) {
  const price = input.pricing; const fixed = currencyMicros(price.fixedRequestCost) || 0;
  const baseInput = pricedTokens(Math.max(0, input.inputTokens - (input.cachedInputTokens || 0)), currencyMicros(price.inputPricePerMillion));
  const cached = pricedTokens(input.cachedInputTokens || 0, currencyMicros(price.cachedInputPricePerMillion) ?? currencyMicros(price.inputPricePerMillion));
  const reasoning = pricedTokens(input.reasoningTokens || 0, currencyMicros(price.reasoningPricePerMillion) ?? currencyMicros(price.outputPricePerMillion));
  const outputPrice = currencyMicros(price.outputPricePerMillion); const minimumMicros = fixed + baseInput + cached + reasoning;
  const expectedMicros = minimumMicros + pricedTokens(input.expectedOutputTokens ?? Math.ceil(input.maximumOutputTokens / 2), outputPrice);
  const oneMaximum = minimumMicros + pricedTokens(input.maximumOutputTokens, outputPrice); const maximumMicros = oneMaximum * (1 + Math.max(0, input.retryAllowance || 0));
  const ageDays = price.lastVerifiedAt ? Math.floor((Date.now() - new Date(price.lastVerifiedAt).getTime()) / 86_400_000) : null;
  return { minimumEstimatedCost: currencyFromMicros(minimumMicros), expectedEstimatedCost: currencyFromMicros(expectedMicros), maximumEstimatedCost: currencyFromMicros(maximumMicros), confidence: price.estimated ? "ESTIMATED" : "CONFIGURED", currency: price.currency || "USD", pricingSource: price.pricingSource || "Administrator configuration", pricingAgeDays: ageDays };
}

export type ContextSection = { id: string; content: string; priority: "REQUIRED" | "HIGH" | "NORMAL" | "LOW" | "OPTIONAL"; kind?: "SYSTEM" | "SAFETY" | "SCHEMA" | "CONTEXT" | "METADATA" };
export function trimContext(sections: ContextSection[], maximumTokens: number, strategy: "REJECT" | "REMOVE_OLDEST" | "REMOVE_LOWEST_PRIORITY" | "REMOVE_DUPLICATES" = "REJECT") {
  const originalTokenEstimate = sections.reduce((sum, section) => sum + estimateTokens(section.content), 0);
  if (originalTokenEstimate <= maximumTokens) return { sections, report: { strategy, originalTokenEstimate, finalTokenEstimate: originalTokenEstimate, savedTokenEstimate: 0, removedSections: [] as string[] } };
  if (strategy === "REJECT") throw new AiError("AI_CONTEXT_TRIMMING_FAILED", undefined, 409, undefined, { original_tokens: originalTokenEstimate, maximum_tokens: maximumTokens });
  const protectedSection = (section: ContextSection) => section.priority === "REQUIRED" || section.kind === "SYSTEM" || section.kind === "SAFETY" || section.kind === "SCHEMA";
  const candidates = sections.map((section, index) => ({ section, index, tokens: estimateTokens(section.content) }));
  let ordered = candidates.filter(({ section }) => !protectedSection(section));
  if (strategy === "REMOVE_LOWEST_PRIORITY") { const rank = { OPTIONAL: 0, LOW: 1, NORMAL: 2, HIGH: 3, REQUIRED: 4 }; ordered.sort((a, b) => rank[a.section.priority] - rank[b.section.priority] || a.index - b.index); }
  if (strategy === "REMOVE_OLDEST") ordered.sort((a, b) => a.index - b.index);
  if (strategy === "REMOVE_DUPLICATES") { const seen = new Set<string>(); ordered = ordered.filter(({ section }) => { const hash = section.content.trim().toLowerCase(); if (seen.has(hash)) return true; seen.add(hash); return false; }); }
  const removed = new Set<number>(); let finalTokenEstimate = originalTokenEstimate;
  for (const candidate of ordered) { if (finalTokenEstimate <= maximumTokens) break; removed.add(candidate.index); finalTokenEstimate -= candidate.tokens; }
  if (finalTokenEstimate > maximumTokens) throw new AiError("AI_CONTEXT_TRIMMING_FAILED", undefined, 409, undefined, { required_tokens: finalTokenEstimate, maximum_tokens: maximumTokens });
  return { sections: sections.filter((_, index) => !removed.has(index)), report: { strategy, originalTokenEstimate, finalTokenEstimate, savedTokenEstimate: originalTokenEstimate - finalTokenEstimate, removedSections: Array.from(removed).map((index) => sections[index].id) } };
}

export function budgetPeriod(now: Date, resetDay: number) {
  const day = Math.min(28, Math.max(1, resetDay)); let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (now < start) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day));
  return { start, end };
}

export function wouldExceedBudget(limit: string | number | null | undefined, used: string | number, reserved: string | number, pending: string | number) {
  if (limit == null) return false; const cap = currencyMicros(limit)!; return (currencyMicros(used) || 0) + (currencyMicros(reserved) || 0) + (currencyMicros(pending) || 0) > cap;
}

export function alertDeduplicationKey(condition: string, scopeType: string, scopeId: string | null | undefined, threshold: number, periodStart: Date) { return [condition, scopeType, scopeId || "global", threshold, periodStart.toISOString()].join(":"); }

export type AiCostCandidate = { providerId: string; model: string; estimatedCost: number; local: boolean; paid: boolean; capabilities: readonly string[]; contextTokens: number };
export function selectCheaperEligibleModel(input: { preferred: AiCostCandidate; candidates: AiCostCandidate[]; requiredCapabilities: readonly string[]; minimumContextTokens: number; privacyMode: AiPrivacyMode; allowPaidProviderFallback: boolean }) {
  const eligible = input.candidates.filter((candidate) => candidate.estimatedCost < input.preferred.estimatedCost && candidate.contextTokens >= input.minimumContextTokens && input.requiredCapabilities.every((capability) => candidate.capabilities.includes(capability)) && (input.privacyMode !== "LOCAL_ONLY" || candidate.local) && (input.allowPaidProviderFallback || input.preferred.paid || !candidate.paid));
  const selected = eligible.sort((left, right) => left.estimatedCost - right.estimatedCost || left.providerId.localeCompare(right.providerId) || left.model.localeCompare(right.model))[0];
  return selected ? { selected, originallyRequested: input.preferred, reason: "CHEAPER_COMPATIBLE_MODEL", estimatedSavings: Math.max(0, input.preferred.estimatedCost - selected.estimatedCost), crossedProviderBoundary: selected.providerId !== input.preferred.providerId, crossedLocalExternalBoundary: selected.local !== input.preferred.local } : null;
}
