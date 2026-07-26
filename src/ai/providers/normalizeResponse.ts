import type { AiProviderType, AiUsage } from "../contracts";
import { AiError, type AiErrorCategory } from "../errors";

export type NormalizedAIResponse = {
  text: string;
  finishReason?: string;
  usage?: AiUsage;
  model?: string;
  providerMetadata?: Record<string, unknown>;
  hasReasoningContent: boolean;
  reasoningCharacterCount: number;
  finalContentCharacterCount: number;
};

type TransportMetadata = {
  httpStatus?: number;
  contentType?: string;
  bodyLength?: number;
  endpointHostname?: string;
  streamed?: boolean;
  providerRequestId?: string;
};

export type AIResponseNormalizationOptions = {
  providerType: AiProviderType;
  provider: string;
  requestedModel: string;
  requestId: string;
  transport?: TransportMetadata;
  allowDirectStructuredObject?: boolean;
};

function record(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const toJson = (value as any).toJSON;
  if (typeof toJson === "function") {
    try {
      const converted = toJson.call(value);
      if (converted && typeof converted === "object" && !Array.isArray(converted)) return converted;
    } catch { /* Fall through to the SDK object's enumerable properties. */ }
  }
  return value as Record<string, any>;
}

function finiteToken(value: unknown) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizeAIUsage(response: unknown): AiUsage | undefined {
  const payload = record(response);
  const usage = record(payload?.usage);
  if (!usage) return undefined;
  const inputTokens = finiteToken(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens);
  const outputTokens = finiteToken(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens);
  const totalTokens = finiteToken(usage.total_tokens ?? usage.totalTokens) ?? (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : undefined);
  const cachedTokens = finiteToken(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens);
  const reasoningTokens = finiteToken(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens);
  const acceptedPredictionTokens = finiteToken(usage.completion_tokens_details?.accepted_prediction_tokens ?? usage.output_tokens_details?.accepted_prediction_tokens);
  const rejectedPredictionTokens = finiteToken(usage.completion_tokens_details?.rejected_prediction_tokens ?? usage.output_tokens_details?.rejected_prediction_tokens);
  const finalAnswerTokens = outputTokens != null && reasoningTokens != null && reasoningTokens <= outputTokens ? outputTokens - reasoningTokens : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
    finalAnswerTokens,
    acceptedPredictionTokens,
    rejectedPredictionTokens,
    providerReported: true,
    providerRequestId: typeof payload?.id === "string" ? payload.id : undefined,
    rawUsage: usage,
  };
}

function nestedText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const item = record(value);
  if (!item) return undefined;
  if (typeof item.text === "string") return item.text;
  if (typeof item.value === "string") return item.value;
  if (record(item.text) && typeof item.text.value === "string") return item.text.value;
  return undefined;
}

function textualBlocks(value: unknown, allowStructuredObject = false): { text?: string; blockCount?: number } {
  if (!Array.isArray(value)) {
    const text = nestedText(value);
    if (text != null) return { text };
    const item = record(value);
    if (allowStructuredObject && item && (!item.type || ["text", "output_text"].includes(String(item.type)))) return { text: JSON.stringify(value) };
    return {};
  }
  const parts: string[] = [];
  for (const block of value) {
    const item = record(block);
    if (!item || !["text", "output_text"].includes(String(item.type || ""))) continue;
    const text = nestedText(item.text ?? item);
    if (text != null) parts.push(text);
  }
  return { text: parts.length ? parts.join("") : undefined, blockCount: value.length };
}

function outputText(value: unknown): { text?: string; blockCount: number } {
  if (!Array.isArray(value)) return { blockCount: 0 };
  const parts: string[] = [];
  let blockCount = 0;
  for (const output of value) {
    const item = record(output);
    const blocks = Array.isArray(item?.content) ? item.content : [];
    blockCount += blocks.length;
    const extracted = textualBlocks(blocks).text;
    if (extracted != null) parts.push(extracted);
  }
  return { text: parts.length ? parts.join("") : undefined, blockCount };
}

function valueType(value: unknown) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function owns(value: unknown, key: string) {
  return !!record(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function safeKeys(value: unknown) {
  return Object.keys(record(value) || {}).filter((key) => !/authorization|cookie|secret|credential|api[_-]?key|access[_-]?token|session/i.test(key)).slice(0, 50).map((key) => key.slice(0, 100));
}

export function normalizeAIResponse(response: unknown, options: AIResponseNormalizationOptions): NormalizedAIResponse {
  const payload = record(response);
  const choice = Array.isArray(payload?.choices) ? record(payload.choices[0]) : undefined;
  const message = record(choice?.message);
  const directMessage = record(payload?.message);
  const messageContent = message?.content;
  const finishReasonValue = choice?.finish_reason ?? choice?.finishReason ?? payload?.stop_reason ?? payload?.done_reason ?? payload?.status;
  const finishReason = typeof finishReasonValue === "string" ? finishReasonValue : undefined;
  const usage = normalizeAIUsage(payload);
  const reasoning = textualBlocks(message?.reasoning_content).text;
  const hasReasoningContent = typeof reasoning === "string" && !!reasoning.trim();
  const reasoningCharacterCount = typeof reasoning === "string" ? reasoning.length : 0;
  const normalizedFinishReason = String(finishReason || "").trim().toLowerCase();
  const truncated = ["length", "max_tokens", "max_output_tokens", "incomplete"].includes(normalizedFinishReason);
  const attempts: string[] = [];
  let contentBlockCount: number | undefined;
  let knownFinalPath = false;
  let finalText: string | undefined;
  let extractorPath: string | undefined;
  const recognizedChatShape = Array.isArray(payload?.choices) && !!choice && owns(choice, "message");

  const chatCandidates: Array<{ path: string; present: boolean; extract: () => { text?: string; blockCount?: number } }> = [
    { path: "choices[0].message.content", present: owns(message, "content"), extract: () => textualBlocks(messageContent, true) },
    { path: "choices[0].text", present: owns(choice, "text"), extract: () => textualBlocks(choice?.text) },
  ];
  const otherCandidates: typeof chatCandidates = [
    { path: "message.content", present: owns(directMessage, "content"), extract: () => textualBlocks(directMessage?.content, true) },
    { path: "output_text", present: owns(payload, "output_text"), extract: () => textualBlocks(payload?.output_text) },
    { path: "output[].content[]", present: Array.isArray(payload?.output), extract: () => outputText(payload?.output) },
    { path: "content", present: owns(payload, "content"), extract: () => textualBlocks(payload?.content, true) },
    { path: "$", present: typeof response === "string", extract: () => ({ text: response as string }) },
  ];
  const candidates = recognizedChatShape ? chatCandidates : [...chatCandidates, ...otherCandidates];

  for (const candidate of candidates) {
    attempts.push(candidate.path);
    if (!candidate.present) continue;
    knownFinalPath = true;
    const extracted = candidate.extract();
    if (extracted.blockCount != null) contentBlockCount = extracted.blockCount;
    if (typeof extracted.text === "string" && extracted.text.trim()) {
      finalText = extracted.text.trim();
      extractorPath = candidate.path;
      break;
    }
  }

  const envelopeKeys = new Set(["id", "object", "created", "model", "choices", "message", "output_text", "output", "content", "usage", "done", "done_reason", "status"]);
  const hasKnownEnvelope = typeof response === "string" || safeKeys(payload).some((key) => envelopeKeys.has(key));
  if (!finalText && options.allowDirectStructuredObject && payload && !hasKnownEnvelope) {
    attempts.push("$ (direct structured object)");
    finalText = JSON.stringify(payload);
    extractorPath = "$";
  }

  const contentBlocks = Array.isArray(messageContent) ? messageContent : Array.isArray(payload?.content) ? payload.content : [];
  const hasRefusal = typeof message?.refusal === "string" && !!message.refusal.trim()
    || contentBlocks.some((block: any) => block?.type === "refusal" || typeof block?.refusal === "string");
  const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0
    || !!message?.function_call
    || contentBlocks.some((block: any) => ["function_call", "tool_call", "tool_use"].includes(String(block?.type || "")))
    || (Array.isArray(payload?.output) && payload.output.some((item: any) => ["function_call", "tool_call", "tool_use"].includes(String(item?.type || ""))));
  const category: AiErrorCategory = hasRefusal ? "AI_PROVIDER_REFUSAL"
    : hasToolCalls ? "AI_PROVIDER_TOOL_CALL_ONLY"
    : truncated && finalText ? "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE"
    : truncated && hasReasoningContent ? "AI_PROVIDER_TRUNCATED_BEFORE_FINAL"
    : truncated ? "AI_PROVIDER_TRUNCATED_RESPONSE"
    : knownFinalPath ? "AI_PROVIDER_EMPTY_RESPONSE"
    : "AI_PROVIDER_UNSUPPORTED_RESPONSE_SHAPE";
  const details: Record<string, unknown> = {
    request_id: options.requestId,
    provider: options.provider,
    model: options.requestedModel,
    stage: "CONTENT_EXTRACTION",
    failure_stage: category === "AI_PROVIDER_EMPTY_RESPONSE" ? "ASSISTANT_CONTENT_EMPTY" : category.replace(/^AI_PROVIDER_/, ""),
    endpoint_hostname: options.transport?.endpointHostname,
    http_status: options.transport?.httpStatus,
    response_content_type: options.transport?.contentType,
    response_body_length: options.transport?.bodyLength,
    response_streamed: options.transport?.streamed,
    top_level_keys: safeKeys(payload),
    choice_count: Array.isArray(payload?.choices) ? payload.choices.length : 0,
    first_choice_keys: safeKeys(choice),
    message_keys: safeKeys(message),
    content_value_type: valueType(messageContent),
    content_block_count: contentBlockCount,
    content_length: typeof finalText === "string" ? finalText.length : typeof messageContent === "string" ? messageContent.length : undefined,
    finish_reason: finishReason,
    has_reasoning_content: hasReasoningContent,
    reasoning_character_count: reasoningCharacterCount,
    final_content_character_count: finalText?.length || 0,
    parent_category: truncated ? "AI_PROVIDER_TRUNCATED_RESPONSE" : undefined,
    has_tool_calls: hasToolCalls,
    has_usage: !!usage,
    extractor_path_attempts: attempts,
    usage_input_tokens: usage?.inputTokens,
    usage_output_tokens: usage?.outputTokens,
    usage_total_tokens: usage?.totalTokens,
    usage_reasoning_tokens: usage?.reasoningTokens,
    usage_final_answer_tokens: usage?.finalAnswerTokens,
    usage_accepted_prediction_tokens: usage?.acceptedPredictionTokens,
    usage_rejected_prediction_tokens: usage?.rejectedPredictionTokens,
    usage_provider_reported: usage?.providerReported === true,
    provider_request_id: options.transport?.providerRequestId || usage?.providerRequestId,
    actual_cost: finiteToken(payload?.usage?.cost ?? payload?.cost),
    billing_possible: options.transport?.httpStatus === 200,
  };
  if (finalText && !truncated && !hasRefusal && !hasToolCalls) {
    return {
      text: finalText,
      finishReason,
      usage,
      model: typeof payload?.model === "string" ? payload.model : undefined,
      providerMetadata: { responseId: typeof payload?.id === "string" ? payload.id : undefined, extractorPath },
      hasReasoningContent,
      reasoningCharacterCount,
      finalContentCharacterCount: finalText.length,
    };
  }
  console.warn("[AI Content Extraction] no final text found", {
    provider: options.provider, model: options.requestedModel, requestId: options.requestId,
    topLevelKeys: details.top_level_keys, choiceCount: details.choice_count,
    firstChoiceKeys: details.first_choice_keys, messageKeys: details.message_keys,
    contentType: options.transport?.contentType, contentValueType: details.content_value_type,
    contentBlockCount: details.content_block_count, finishReason,
    hasReasoningContent: details.has_reasoning_content, reasoningCharacterCount, finalContentCharacterCount: finalText?.length || 0, hasToolCalls, hasUsage: !!usage,
    responseBodyLength: options.transport?.bodyLength, extractorPathAttempts: attempts,
  });
  throw new AiError(category, undefined, undefined, undefined, details);
}
