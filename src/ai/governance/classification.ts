import type { ResolvedAiProviderConfig } from "../contracts";

export type AiProviderModelClassification = "LOCAL_FREE" | "EXTERNAL_FREE_OR_UNPRICED" | "EXTERNAL_PAID" | "UNKNOWN";
export type AiProviderLocality = "LOCAL" | "EXTERNAL" | "UNKNOWN";

export type AiClassificationResult = {
  classification: AiProviderModelClassification;
  locality: AiProviderLocality;
  pricingClassification: "FREE" | "UNPRICED" | "PAID" | "UNKNOWN";
  requiresPaidProviderPermission: boolean;
  missingPricingPermitted: boolean;
  reason: string;
};

type ProviderLike = Pick<ResolvedAiProviderConfig, "providerType" | "baseUrl" | "locationClassification"> & {
  administratorConfirmedLocal?: boolean;
  trustedNetwork?: boolean;
  customConfiguration?: Record<string, unknown> | null;
  customConfigurationJson?: unknown;
};

type PricingLike = {
  billingClassification?: string | null;
  status?: string | null;
  inputPricePerMillion?: unknown;
  outputPricePerMillion?: unknown;
  fixedRequestCost?: unknown;
} | null;

const explicitClassifications = new Set<AiProviderModelClassification>(["LOCAL_FREE", "EXTERNAL_FREE_OR_UNPRICED", "EXTERNAL_PAID", "UNKNOWN"]);

function configuration(provider: ProviderLike) {
  const value = provider.customConfiguration || provider.customConfigurationJson;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function explicitClassification(provider: ProviderLike, model: string) {
  const config = configuration(provider);
  const modelValue = config.modelClassifications && typeof config.modelClassifications === "object" ? config.modelClassifications[model] : undefined;
  const value = modelValue || config.providerModelClassification || config.providerClassification;
  return typeof value === "string" && explicitClassifications.has(value as AiProviderModelClassification) ? value as AiProviderModelClassification : null;
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function isConfiguredInternalHost(provider: ProviderLike, hostname: string) {
  const configured = configuration(provider).internalHostnames;
  return Array.isArray(configured) && configured.some((value) => typeof value === "string" && value.trim().toLowerCase() === hostname);
}

export function isLocalProviderUrl(provider: ProviderLike) {
  if (!provider.baseUrl) return false;
  let hostname: string;
  try { hostname = new URL(provider.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return false; }
  if (["localhost", "::1", "0:0:0:0:0:0:0:1", "host.docker.internal", "gateway.docker.internal", "ollama"].includes(hostname)) return true;
  if (isPrivateIpv4(hostname) || /^(fc|fd|fe8|fe9|fea|feb)/i.test(hostname)) return true;
  return isConfiguredInternalHost(provider, hostname);
}

function hasConfiguredPrice(pricing: PricingLike | undefined) {
  return !!pricing && [pricing.inputPricePerMillion, pricing.outputPricePerMillion, pricing.fixedRequestCost].some((value) => value != null);
}

export function classifyProviderAndModel(provider: ProviderLike, model: string, pricing?: PricingLike): AiClassificationResult {
  const explicit = explicitClassification(provider, model);
  if (explicit) {
    if (explicit === "LOCAL_FREE") return { classification: explicit, locality: "LOCAL", pricingClassification: "FREE", requiresPaidProviderPermission: false, missingPricingPermitted: true, reason: "Provider or model configuration explicitly classifies this model as local and free." };
    if (explicit === "EXTERNAL_PAID") return { classification: explicit, locality: "EXTERNAL", pricingClassification: "PAID", requiresPaidProviderPermission: true, missingPricingPermitted: false, reason: "Provider or model configuration explicitly classifies this model as externally billed." };
    if (explicit === "EXTERNAL_FREE_OR_UNPRICED") return { classification: explicit, locality: "EXTERNAL", pricingClassification: pricing?.status === "FREE" ? "FREE" : "UNPRICED", requiresPaidProviderPermission: false, missingPricingPermitted: false, reason: "Provider or model configuration explicitly classifies this model as external and free or unpriced." };
    return { classification: "UNKNOWN", locality: "UNKNOWN", pricingClassification: "UNKNOWN", requiresPaidProviderPermission: false, missingPricingPermitted: false, reason: "Provider or model configuration explicitly leaves classification unknown." };
  }

  const explicitlyRemote = provider.locationClassification === "REMOTE";
  const explicitlyLocal = provider.locationClassification === "LOCAL" && provider.administratorConfirmedLocal === true && provider.trustedNetwork === true;
  const inferredLocalOllama = provider.providerType === "ollama" && !explicitlyRemote && isLocalProviderUrl(provider);
  const local = explicitlyLocal || inferredLocalOllama;

  // OpenAI API requests are externally billed even when a newly discovered model
  // does not yet have a Mixarr pricing profile. Billing class and pricing
  // availability are deliberately separate dimensions.
  if (provider.providerType === "openai" && !local) return { classification: "EXTERNAL_PAID", locality: "EXTERNAL", pricingClassification: pricing?.status === "FREE" ? "FREE" : hasConfiguredPrice(pricing) ? "PAID" : "UNPRICED", requiresPaidProviderPermission: true, missingPricingPermitted: false, reason: "Native OpenAI API usage is classified as externally billed; model pricing may still require configuration." };

  // A model-level paid pricing declaration always wins, even for an otherwise local protocol endpoint.
  const paid = pricing?.billingClassification === "EXTERNAL" && (pricing.status === "PRICED" || hasConfiguredPrice(pricing));
  if (paid) return { classification: "EXTERNAL_PAID", locality: "EXTERNAL", pricingClassification: "PAID", requiresPaidProviderPermission: true, missingPricingPermitted: false, reason: "The active model pricing profile explicitly marks this model as externally billed." };
  if (local) return { classification: "LOCAL_FREE", locality: "LOCAL", pricingClassification: "FREE", requiresPaidProviderPermission: false, missingPricingPermitted: true, reason: inferredLocalOllama && !explicitlyLocal ? "The Ollama base URL resolves to a loopback, private-network, Docker-network, or configured internal hostname." : "The administrator explicitly classified this trusted endpoint as local." };
  if (explicitlyRemote || provider.locationClassification === "USER_CLASSIFIED") {
    const free = pricing?.billingClassification === "FREE" || pricing?.status === "FREE";
    return { classification: "EXTERNAL_FREE_OR_UNPRICED", locality: "EXTERNAL", pricingClassification: free ? "FREE" : "UNPRICED", requiresPaidProviderPermission: false, missingPricingPermitted: false, reason: free ? "The external model has an active free pricing profile." : "The provider is external and no paid pricing profile is configured." };
  }
  return { classification: "UNKNOWN", locality: "UNKNOWN", pricingClassification: "UNKNOWN", requiresPaidProviderPermission: false, missingPricingPermitted: false, reason: "The provider is not explicitly remote and its endpoint cannot be safely classified as local." };
}

export type ResolvedPermission = { allowed: boolean; source: "ADMIN_EXEMPTION" | "USER_OVERRIDE" | "GLOBAL_POLICY"; value: boolean };

export function resolvePaidProviderPermission(input: { globalAllowed: boolean; allowUserOverrides: boolean; userValue: boolean | null | undefined; adminExempt?: boolean }): ResolvedPermission {
  if (input.adminExempt) return { allowed: true, value: true, source: "ADMIN_EXEMPTION" };
  if (input.userValue === false) return { allowed: false, value: false, source: "USER_OVERRIDE" };
  if (input.userValue === true && input.allowUserOverrides) return { allowed: true, value: true, source: "USER_OVERRIDE" };
  return { allowed: input.globalAllowed, value: input.globalAllowed, source: "GLOBAL_POLICY" };
}
