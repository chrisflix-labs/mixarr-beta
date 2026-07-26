export type ProviderWizardForm = Record<string, any>;

export type ProviderWizardValidation = {
  valid: boolean;
  fieldErrors: Record<string, string>;
  firstInvalidField?: string;
  firstInvalidStep?: number;
};

export const PROVIDER_FIELD_STEPS: Record<string, number> = {
  providerType: 1,
  displayName: 1,
  locationClassification: 1,
  baseUrl: 1,
  authenticationType: 2,
  apiKey: 2,
  nonSecretHeadersText: 2,
  secretHeadersText: 2,
  defaultModel: 3,
  fallbackProviderId: 3,
  requestTimeoutMs: 3,
  retryCount: 3,
  initialRetryDelayMs: 3,
  maximumRetryDelayMs: 3,
  retryBackoffMultiplier: 3,
  healthCheckIntervalMinutes: 3,
  monthlyBudget: 3,
  administratorConfirmedLocal: 4,
  trustedNetwork: 4,
  notes: 4,
};

const providerTypes = new Set(["ollama", "litellm", "lm_studio", "deepseek", "openai", "chatgpt_subscription", "openai_compatible", "openrouter", "anthropic"]);
const locations = new Set(["LOCAL", "REMOTE", "USER_CLASSIFIED", "UNKNOWN"]);
const authenticationTypes = new Set(["NONE", "API_KEY_HEADER", "BEARER", "BASIC", "PROVIDER_SPECIFIC", "OFFICIAL_OAUTH", "CUSTOM_SECRET_HEADERS"]);

function parseHeaderObject(value: unknown, secret = false) {
  const parsed = JSON.parse(String(value || "{}"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Headers must be a JSON object.");
  for (const [name, raw] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || typeof raw !== "string" || (secret && !raw) || raw.length > (secret ? 4096 : 1024)) throw new Error(secret ? "Secret header names and non-empty string values are required." : "Header names and string values are invalid.");
    if (!secret && (/^(authorization|proxy-authorization|cookie|set-cookie|x-plex-token)$/i.test(name) || /(api[-_]?key|token|secret|password)/i.test(name))) throw new Error(`Header ${name} must be configured as a secret header.`);
  }
  return parsed as Record<string, unknown>;
}

function numberError(value: unknown, minimum: number, maximum: number, integer: boolean, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < minimum || number > maximum) {
    return `${label} must be ${integer ? "a whole number" : "a number"} from ${minimum} to ${maximum}.`;
  }
  return null;
}

export function validateProviderWizard(form: ProviderWizardForm): ProviderWizardValidation {
  const fieldErrors: Record<string, string> = {};
  const add = (field: string, message: string) => { if (!fieldErrors[field]) fieldErrors[field] = message; };

  if (!providerTypes.has(String(form.providerType || ""))) add("providerType", "Choose an available provider type.");
  if (form.providerType === "chatgpt_subscription") add("providerType", "ChatGPT subscriptions are not a supported API provider. Choose OpenAI API instead.");
  if (!String(form.displayName || "").trim()) add("displayName", "Enter a provider display name.");
  if (!locations.has(String(form.locationClassification || ""))) add("locationClassification", "Choose a valid location classification.");

  if (!String(form.baseUrl || "").trim()) add("baseUrl", "Enter the provider base URL.");
  else {
    try {
      const url = new URL(String(form.baseUrl).trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) add("baseUrl", "Use an HTTP(S) URL without embedded credentials.");
    } catch { add("baseUrl", "Enter a valid provider base URL."); }
  }

  if (!authenticationTypes.has(String(form.authenticationType || ""))) add("authenticationType", "Choose a valid authentication type.");
  try { parseHeaderObject(form.nonSecretHeadersText); } catch (error) { add("nonSecretHeadersText", (error as Error).message); }
  try { parseHeaderObject(form.secretHeadersText, true); } catch (error) { add("secretHeadersText", (error as Error).message); }

  for (const [field, minimum, maximum, integer, label] of [
    ["requestTimeoutMs", 30000, 600000, true, "Timeout"],
    ["retryCount", 0, 10, true, "Retry count"],
    ["initialRetryDelayMs", 50, 60000, true, "Initial retry delay"],
    ["maximumRetryDelayMs", 50, 300000, true, "Maximum retry delay"],
    ["retryBackoffMultiplier", 1, 10, false, "Retry backoff multiplier"],
    ["healthCheckIntervalMinutes", 1, 10080, true, "Health-check interval"],
  ] as const) {
    const error = numberError(form[field], minimum, maximum, integer, label);
    if (error) add(field, error);
  }
  if (Number(form.maximumRetryDelayMs) < Number(form.initialRetryDelayMs)) add("maximumRetryDelayMs", "Maximum retry delay cannot be less than the initial retry delay.");
  if (form.monthlyBudget !== "" && form.monthlyBudget != null) {
    const error = numberError(form.monthlyBudget, 0, 1000000, false, "Monthly budget");
    if (error) add("monthlyBudget", error);
  }

  if (form.locationClassification === "LOCAL") {
    if (form.administratorConfirmedLocal !== true) add("administratorConfirmedLocal", "Confirm that you inspected this local endpoint.");
    if (form.trustedNetwork !== true) add("trustedNetwork", "Confirm that the endpoint is on an administrator-trusted network.");
  }
  if (String(form.notes || "").length > 2000) add("notes", "Notes must be 2,000 characters or fewer.");

  const firstInvalidField = Object.keys(fieldErrors).sort((left, right) => (PROVIDER_FIELD_STEPS[left] || 4) - (PROVIDER_FIELD_STEPS[right] || 4))[0];
  return {
    valid: !firstInvalidField,
    fieldErrors,
    firstInvalidField,
    firstInvalidStep: firstInvalidField ? PROVIDER_FIELD_STEPS[firstInvalidField] || 4 : undefined,
  };
}

export function buildProviderPayload(form: ProviderWizardForm, editing = false) {
  const payload: ProviderWizardForm = {
    providerType: String(form.providerType),
    displayName: String(form.displayName).trim(),
    enabled: form.providerType === "chatgpt_subscription" ? false : form.enabled === true,
    locationClassification: form.locationClassification,
    administratorConfirmedLocal: form.locationClassification === "LOCAL" && form.administratorConfirmedLocal === true,
    trustedNetwork: form.locationClassification === "LOCAL" && form.trustedNetwork === true,
    externalAccessWarning: form.locationClassification !== "LOCAL",
    baseUrl: String(form.baseUrl).trim().replace(/\/+$/, ""),
    authenticationType: form.authenticationType,
    nonSecretHeaders: parseHeaderObject(form.nonSecretHeadersText),
    defaultModel: String(form.defaultModel || "").trim() || null,
    fastModel: String(form.fastModel || "").trim() || null,
    reasoningModel: String(form.reasoningModel || "").trim() || null,
    fallbackProviderId: form.fallbackProviderId || null,
    requestTimeoutMs: Number(form.requestTimeoutMs),
    retryCount: Number(form.retryCount),
    initialRetryDelayMs: Number(form.initialRetryDelayMs),
    maximumRetryDelayMs: Number(form.maximumRetryDelayMs),
    retryBackoffMultiplier: Number(form.retryBackoffMultiplier),
    sslVerification: form.sslVerification === true,
    modelDiscoveryEnabled: form.modelDiscoveryEnabled === true,
    healthCheckEnabled: form.healthCheckEnabled === true,
    healthCheckIntervalMinutes: Number(form.healthCheckIntervalMinutes),
    monthlyBudget: form.monthlyBudget === "" || form.monthlyBudget == null ? null : Number(form.monthlyBudget),
    notes: String(form.notes || "").trim() || null,
  };

  if (form.removeApiKey) payload.apiKeyAction = "remove";
  else if (String(form.apiKey || "").trim()) { payload.apiKey = String(form.apiKey).trim(); payload.apiKeyAction = "replace"; }
  else if (editing) payload.apiKeyAction = "keep";

  const secretHeaders = parseHeaderObject(form.secretHeadersText, true);
  if (form.removeSecretHeaders) payload.secretHeadersAction = "remove";
  else if (Object.keys(secretHeaders).length) { payload.secretHeaders = secretHeaders; payload.secretHeadersAction = "replace"; }
  else if (editing) payload.secretHeadersAction = "keep";

  return payload;
}
