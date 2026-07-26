# Recipe Copilot reliability (v2.4.15)

## Root cause

Recipe Copilot used the shared AI coordinator, which selected the strictest of the request, provider, global, governance, and deployment timeout policies. The provider and global database defaults were both 30,000 ms, so they always won over the 120,000 ms governance total. The coordinator aborted DeepSeek at 30 seconds, then Recipe Copilot's browser code called `response.json()` before checking the response status or Content-Type. An empty, text, or HTML response from the interrupted route therefore hid the real timeout behind a browser JSON parser error.

## Timeout policy

The coordinator remains the only owner of the total-request `AbortController` timer. `AI_REQUEST_TIMEOUT_SECONDS` is the deployment ceiling and defaults to 120 seconds. It accepts whole seconds from 30 through 600. The request, provider, global, and governance values remain policy inputs; the strictest valid value wins, but they do not create additional timers.

The v2.4.15 migration changes the global and provider defaults from 30,000 to 120,000 ms and upgrades rows still holding the old default. Explicit values other than the legacy default are preserved. Provider health checks retain their shorter administrative timeouts, and stream idle timeout remains a separate stalled-stream safeguard rather than a competing total-request deadline.

## Provider response handling

The shared OpenAI-compatible transport now reads the bounded response once and records safe diagnostics: request ID, provider, model, endpoint hostname, elapsed time, HTTP status, Content-Type, byte length, streaming detection, timeout source, and failure stage. It never logs credentials, authorization headers, prompts, private track metadata, or full provider bodies.

Non-2xx responses, empty successful bodies, unexpected SSE, HTML/text success responses, JSON API error objects, invalid UTF-8, and malformed JSON receive distinct classifications. Successful payload extraction supports chat completion content, Responses-style output text, direct JSON objects, JSON strings, fenced JSON, and explanatory text containing exactly one balanced JSON object.

Recipe Copilot requests JSON Object mode from DeepSeek, validates the normalized result against the strict Recipe Copilot schema, and then passes the proposed patch through the existing recipe analysis and safety flow. If JSON syntax is still malformed after safe local normalization, Mixarr permits one same-provider repair request. It asks only for corrected JSON matching the original schema and never invents missing recipe behavior. A schema-valid but incompatible recipe is rejected without repair, persistence, approval, activation, or execution.

## Error and history contract

Recipe Copilot API failures use the standard JSON envelope with `code`, `message`, `requestId`, `retryable`, `provider`, `model`, `stage`, and `elapsedMs`. The primary classifications are `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_HTTP_ERROR`, `AI_PROVIDER_EMPTY_RESPONSE`, `AI_PROVIDER_INVALID_RESPONSE`, `AI_RECIPE_SCHEMA_INVALID`, and `AI_RECIPE_REQUEST_FAILED`.

The browser checks Content-Type and status before treating a body as success data. Non-JSON errors produce a safe fallback instead of a JSON parser exception, and the request ID is displayed for troubleshooting.

AI audit and Recipe Copilot history use the same request ID. Recipe Copilot success is `SUCCESS` (the shared AI audit retains its established `COMPLETED` status), true timeout is `TIMED_OUT`, and invalid or schema-breaking output is `INVALID_RESPONSE`. Provider usage and cost are recorded when reported. When a timeout has no usage payload, history marks usage unavailable and possible provider billing remains unknown; `$0.00` is not treated as proof that the provider performed no billable work.

## Governance boundary

Metadata Limited still excludes identifiers, track lists, library IDs, credentials, paths, and private recipe labels. Provider approval, feature approval, privacy rules, external confirmation, token and response limits, pricing and cost limits, request limits, budgets, and cancellation remain enforced. A generated recipe remains an unsaved, inactive, unapproved review draft until the user explicitly reviews and applies it.
