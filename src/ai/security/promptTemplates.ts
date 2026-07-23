import crypto from "crypto";

const TOKEN = /{{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*}}/g;
const UNSAFE = /(?:^|\n)\s*(?:system|assistant|developer)\s*:|ignore\s+(?:all\s+)?previous\s+instructions|bypass\s+(?:mixarr|safety|validation)/i;

export type PromptTemplateDefinition = { featureKey: string; template: string; requiredVariables: string[]; allowedVariables: string[]; maximumCharacters?: number; disallowedVariables?: string[]; structuredOutput?: boolean };

export function validatePromptTemplate(input: PromptTemplateDefinition) {
  const errors: Array<{ code: string; variable?: string }> = [];
  if (input.template.length > (input.maximumCharacters || 40_000)) errors.push({ code: "excessive_prompt_size" });
  if (/{%|<%|\$\{|{{{/.test(input.template)) errors.push({ code: "unsupported_template_syntax" });
  if (UNSAFE.test(input.template)) errors.push({ code: "unsafe_policy_override" });
  const variables = Array.from(input.template.matchAll(TOKEN), (match) => match[1]);
  const allowed = new Set(input.allowedVariables);
  const disallowed = new Set(input.disallowedVariables || ["api_key", "password", "credential", "provider_secret", "environment"]);
  for (const variable of variables) {
    if (!allowed.has(variable)) errors.push({ code: "unknown_variable", variable });
    if (disallowed.has(variable)) errors.push({ code: "disallowed_data_placeholder", variable });
  }
  for (const variable of input.requiredVariables) if (!variables.includes(variable)) errors.push({ code: "missing_variable", variable });
  if (/{{[^}]*$|^[^{]*}}/.test(input.template)) errors.push({ code: "unresolved_template_token" });
  if (input.structuredOutput && !/json|schema|structured/i.test(input.template)) errors.push({ code: "invalid_structured_output_instruction" });
  return { valid: errors.length === 0, errors, variables: Array.from(new Set(variables)), version: crypto.createHash("sha256").update(`${input.featureKey}\0${input.template}`).digest("hex") };
}

export function renderValidatedPrompt(input: PromptTemplateDefinition, values: Record<string, string>) {
  const validation = validatePromptTemplate(input);
  if (!validation.valid) throw Object.assign(new Error("Prompt template validation failed."), { code: "AI_PROMPT_TEMPLATE_INVALID", details: validation.errors });
  const missing = input.requiredVariables.filter((variable) => values[variable] == null);
  if (missing.length) throw Object.assign(new Error("Prompt template variables are missing."), { code: "AI_PROMPT_TEMPLATE_INVALID", details: missing });
  const rendered = input.template.replace(TOKEN, (_token, variable: string) => values[variable] ?? "");
  if (TOKEN.test(rendered)) throw Object.assign(new Error("Prompt template contains unresolved tokens."), { code: "AI_PROMPT_TEMPLATE_INVALID" });
  return { rendered, version: validation.version };
}

