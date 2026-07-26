# DeepSeek V4 thinking and provider tests (v2.4.16)

Mixarr supports `deepseek-v4-pro` and `deepseek-v4-flash` through the OpenAI-compatible Chat Completions endpoint. These models advertise a thinking mode whose tokens share the completion output allowance with the final answer. If thinking consumes that allowance first, DeepSeek can return HTTP 200 with `finish_reason: "length"`, non-empty `reasoning_content`, and empty `message.content`. HTTP success means the provider accepted and processed the request; it does not mean the model produced a complete usable answer.

## Thinking configuration

DeepSeek V4 provider settings expose:

- **Off** — faster, cheaper, and recommended for structured Mixarr requests.
- **On** — permits additional provider reasoning and may increase tokens, cost, and latency.
- **Provider default** — omits the explicit field and lets DeepSeek choose.

New DeepSeek configurations default to Off. Existing configurations without a saved mode retain provider-default behavior for free-form advisory requests. Provider connectivity tests always send `"thinking":{"type":"disabled"}`. Structured JSON requests also default to Off unless the calling feature explicitly opts into reasoning. When thinking is enabled, Mixarr can send supported reasoning effort but omits temperature, top-p, presence-penalty, and frequency-penalty controls.

## Dedicated provider-test profile

The test sends no library or user metadata:

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    { "role": "system", "content": "You are performing an AI provider connectivity test. Return only valid JSON and no additional text." },
    { "role": "user", "content": "Return exactly this JSON object: {\"ok\":true}" }
  ],
  "max_tokens": 128,
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" },
  "stream": false
}
```

The allowance is bounded by positive global, provider, user, model, and combined hard limits. Provider tests do not inherit unrelated feature limits. Zero keeps Mixarr's established unlimited/unset meaning and is never sent as `max_tokens: 0`. A hard limit below 128 returns `AI_PROVIDER_TEST_TOKEN_LIMIT_TOO_LOW` with the limiting source. After one length-limited result, Mixarr may make one budget-governed retry at up to 256 tokens. It never makes a second retry, and normal feature truncations are not automatically retried.

A passing test requires HTTP success, a choice, a normalized successful finish reason, non-empty final `message.content`, valid JSON, and exactly `{ "ok": true }`. Invalid JSON after a normal stop is classified separately from truncation.

## Truncation and privacy

`message.content` is the final answer. `reasoning_content` is private provider metadata and is never a fallback answer. Mixarr classifies a length stop with reasoning but no final content as `AI_PROVIDER_TRUNCATED_BEFORE_FINAL`; a length stop with partial final content is `AI_PROVIDER_TRUNCATED_FINAL_RESPONSE`. The older `AI_PROVIDER_TRUNCATED_RESPONSE` remains available as the parent category in sanitized diagnostics.

Mixarr never returns, logs, audits, stores, or displays raw `reasoning_content`. Sanitized diagnostics may record only whether it existed, its character count, provider-reported reasoning token counts, and whether final content existed. Credentials, authorization headers, complete raw responses, and provider-test prompts containing library metadata are also excluded.
