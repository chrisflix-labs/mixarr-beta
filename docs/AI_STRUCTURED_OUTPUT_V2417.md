# AI token-limit removal and Recipe Copilot structured output (v2.4.17)

## What changed

Mixarr no longer exposes or enforces application-configured input, output, completion, prompt, reasoning, request, provider, feature, or user token caps. Normal AI requests and connectivity tests omit `max_tokens`, `max_completion_tokens`, and `max_output_tokens`. Existing saved values are ignored immediately after upgrade.

This does not remove provider constraints. The selected provider and model may enforce native context and output limits. Mixarr retains native context-window validation and reports an oversized prompt as `AI_MODEL_CONTEXT_WINDOW_EXCEEDED`, not as a configurable token-budget failure.

Token estimates remain informational and continue to support monetary cost previews and audit usage metrics. Per-request, daily, monthly, provider, and user cost budgets remain enforced, as do request-count, privacy, authorization, timeout, retry, concurrency, queue, and retention controls.

## Migration notes

Migration `20260726010000_remove_ai_token_limits_v2417` marks the old token-cap columns deprecated without dropping them. This preserves a rollback window. v2.4.17 does not read or write those columns, does not echo them from public settings APIs, and ignores deprecated fields sent by older clients. Existing values such as `0`, `128`, `5500`, or `null` are inert.

Administrators should use monetary budgets and request-count controls for governance. No manual database cleanup is required.

## Recipe Copilot schema fix

The reported DeepSeek response completed normally (`finish_reason: stop`) and parsed as JSON. Sanitized retained diagnostics identified three schema mismatches:

- `proposedPatch.generation.rules[0].operator` used an unsupported enum value.
- `proposedPatch.generation.rules[0].value` was not a string, as required by the production rule schema.
- `proposedPatch.scoring` contained unknown properties rejected by the strict schema.

The original literal values were unavailable because raw response retention was disabled and the body had already been purged. The failure was not timeout, truncation, or token limiting.

Recipe Copilot now derives its provider-facing JSON Schema from the same Zod runtime validator used by Recipe Studio. Provider capability selection is normalized in this order:

1. `strict_json_schema`
2. `json_object`
3. `prompt_only_json`

DeepSeek V4 uses `json_object`. Its structured requests explicitly send `thinking: {"type":"disabled"}`, use `stream: false`, omit reasoning and unsupported sampling parameters, and validate only final `message.content`. OpenAI models that advertise native strict schema receive the canonical Recipe Copilot schema in `response_format.json_schema`.

## Payload change (secrets removed)

Before v2.4.17, the reported DeepSeek request was equivalent to:

```json
{
  "model": "deepseek-v4-pro",
  "messages": ["<system prompt>", "<user prompt>"],
  "temperature": 0.1,
  "max_tokens": 5500,
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" },
  "stream": false
}
```

In v2.4.17 it is:

```json
{
  "model": "deepseek-v4-pro",
  "messages": ["<canonical JSON-only system prompt>", "<user instruction plus canonical schema>"],
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" },
  "stream": false
}
```

## Normalization, repair, and privacy

Mixarr conservatively handles one surrounding JSON fence, one JSON-string layer, one recognized single root wrapper, or harmless prose around exactly one complete object. It applies schema defaults but does not invent required behavior, coerce arbitrary values, or strip unknown fields from the strict Recipe Copilot schema.

After local normalization, one schema-repair request may run when privacy policy and monetary governance permit it. The repair uses the canonical schema and sanitized issue paths, is cost-accounted, and cannot repeat. Recipe drafts remain advisory, inactive, and review-only until a user explicitly reviews and applies them.

Diagnostics record provider/model/request identifiers, finish reason, character count, normalization flags, parse status, issue paths and primitive types, and repair status. They never record the full user prompt, library track metadata, raw provider output, raw reasoning content, secrets, or authorization headers.

Removing application token limits does not guarantee valid JSON; it removes an artificial cap while the structured-output pipeline handles format reliability explicitly.
