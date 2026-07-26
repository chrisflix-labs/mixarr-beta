# Recipe Copilot reasoning output budgets

Recipe Copilot now treats a reasoning model's completion limit as a shared budget for internal reasoning and the visible JSON answer. The model catalog identifies reasoning behavior, output-token parameter names, JSON-mode support, and model maxima in one place. Unknown DeepSeek models receive a conservative reasoning reserve; unknown generic OpenAI-compatible models do not receive unsupported JSON-mode parameters.

The default feature policy targets 2,500 final-answer tokens. Models whose reasoning consumes the completion budget add a 3,000-token reserve, producing a 5,500-token provider limit. The safe minimum is 2,000 tokens for normal chat models and 4,000 tokens for reasoning models. Existing administrator limits are never overwritten; a lower cap returns `AI_REQUIRED_OUTPUT_BUDGET_EXCEEDS_LIMIT` before provider dispatch.

Preflight cost enforcement prices the complete provider output allowance. Normal Recipe Copilot requests are not automatically retried after truncation because another inference could double cost or repeat side effects. A length-limited result is returned with a precise classification so an administrator can adjust the applicable output limit or thinking configuration before the user makes another request. The narrowly controlled one-time truncation retry described for v2.4.16 applies only to the tiny administrative provider-connectivity test.

`reasoning_content` is never returned, stored, logged, or used as Recipe Copilot output. Only its presence and length-independent provider usage counts may be recorded. Provider usage preserves prompt, completion, total, cached, reasoning, accepted-prediction, and rejected-prediction counts when reported; missing categories remain undefined.

Responses ending with `finish_reason: length` are accepted only when the entire final content parses as one JSON value and passes the complete local Recipe Copilot schema. Partial JSON is neither repaired nor continued. Request history distinguishes successful HTTP transport from incomplete model output and records the configured output limit, recovery, fallback, usage, and cost.
