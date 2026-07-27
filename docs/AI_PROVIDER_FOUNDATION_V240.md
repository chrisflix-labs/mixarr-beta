# Mixarr v2.4.0 — AI Provider Foundation

Mixarr v2.4.0 provides optional infrastructure for future advisory AI features. It does not add natural-language playlist creation, AI recipe generation, track selection, regeneration, playlist edits, autonomous agents, provider tools, browsing, filesystem access, or shell access. Deterministic Mixarr behavior remains authoritative and works without an AI provider.

## Upgrade and defaults

Apply Prisma migration `20260721050000_ai_provider_foundation_v240`. It only adds AI tables and indexes. It does not rewrite users, libraries, playlists, recipes, automation settings, or existing secrets. Global AI defaults to disabled, future features default to disabled and unavailable, no provider is created, and migration/startup makes no external AI request.

Before rollback, retain the migration and tables if audit history or encrypted provider configuration must remain available. Rolling application code back while leaving these additive tables in place is safe. Dropping them destroys provider configuration and AI audit history and should only be done after a verified backup.

## Supported provider types

| Type | Protocol | Notes |
| --- | --- | --- |
| Ollama | Native `/api/tags` and `/api/chat` | Local or remote; no key by default; JSON and streaming where the model/server supports them. |
| LiteLLM | OpenAI-compatible | Configurable proxy URL, key, headers, models, streaming, and capability overrides. |
| LM Studio | OpenAI-compatible | Local or remote, optional key, model discovery, and streaming. |
| DeepSeek | OpenAI-compatible | API-key authentication, DeepSeek V4 thinking-mode control, reasoning-safe final-answer extraction, usage capture, structured provider tests, and streaming. |
| OpenAI API | OpenAI-compatible chat | Requires separate API access and an API key. A ChatGPT subscription is not API access. |
| OpenAI-compatible | Configurable | Custom base/model/chat endpoints, authentication, headers, context, and capability overrides. Do not assume every compatible server implements every feature. |
| OpenRouter | OpenAI-compatible | Provider-prefixed models, attribution headers, streaming, usage/cost where returned, and model assignments. |
| Anthropic | Native Messages API | Native headers, models, messages, streaming, usage, and structured JSON prompting/validation. |
| ChatGPT Subscription | Unavailable | Registered for clarity only. Mixarr never scrapes sessions, requests cookies, imports profiles, reuses unofficial tokens, or automates the web interface. Configure OpenAI API instead. |

Multiple instances of any type are supported. Provider type is not an identifier: “Local Ollama” and “Remote Ollama” are separate rows with their own UUIDs, models, health, priorities, fallbacks, and budgets.

Each provider may inherit the global AI timeout policy or enable a complete
provider-specific replacement policy. The provider editor previews the
effective values and offers Ollama presets for slow initial model loading and
no request timeout. Presets populate the form but never save automatically.
See [Local AI Model Loading & Unlimited Timeouts](AI_LOCAL_MODEL_TIMEOUTS_V2422.md).

## Enabling and configuring

Open **Settings → AI Provider Foundation** as an administrator. Add and save a provider, test its connection with the fixed minimal prompt, refresh model discovery, and select default/fast/reasoning models. Saving an untested provider is allowed and leaves it marked **Not tested**.

Global AI and each feature have separate controls. The coordinator rejects a normal request unless global AI, the feature, provider, model, capability, and budget are all eligible. v2.4.0 registers future feature descriptions as unavailable; they cannot be enabled. Manual connection tests remain available while global AI is disabled and never include Plex or library data.

## Credential encryption and backup

Set a long random application-level key:

```env
AI_CREDENTIAL_ENCRYPTION_KEY=replace-with-a-long-random-secret
```

Mixarr falls back to `MIXARR_SECRET_KEY` so existing installations can reuse their authenticated-encryption setup. Provider credentials and secret headers use AES-256-GCM with a random nonce, authentication tag, version marker, and AI-specific authenticated context. The encryption key is never stored in PostgreSQL.

Supply the key through a Docker secret or environment injection where possible. Back it up separately from the database. A database backup without the matching key cannot restore provider credentials; a leaked database alone does not reveal them. Rotation currently requires explicitly replacing provider secrets after changing the key. Keep the old key available until every provider credential is replaced and verified.

If no key is configured, Mixarr continues running. Local providers without secrets can be saved, but new secret-based providers cannot save credentials and existing encrypted providers cannot execute. The UI shows a setup warning. Edit APIs never return encrypted or decrypted values, key prefixes, or key length. Blank fields mean “keep”; removal requires an explicit remove action.

## Trust, prompt, and response boundaries

The prompt builder separates system instructions from user content and wraps approved library fields in deterministic untrusted-data delimiters. Callers choose an allowlist of fields; record counts and field lengths are capped, control characters are removed, and secret/credential/path field names are excluded. Plex token markers are rejected. Full Prisma records, credentials, stack traces, filesystem paths, and arbitrary URLs are not accepted as prompt data.

Provider output is untrusted. Response bytes, JSON depth, array length, and string length are bounded. JSON is parsed and validated again with the feature's Zod schema; provider claims of JSON validity are not trusted. Output is never evaluated as code, interpolated into a shell command, passed directly to Prisma query construction, treated as an unrestricted URL, or used to call playlist mutation endpoints.

## Capabilities, models, health, and privacy

Capabilities are labeled Confirmed, Reported, Assumed, Manually enabled, Unsupported, or Unknown. Adapter defaults, discovery metadata, connection results, and administrator overrides remain distinguishable; Mixarr does not silently advertise unknown support.

Model refresh marks unseen cached models unavailable instead of deleting history or changing configured selections. Manual model identifiers remain accepted. A missing configured model stays configured and is shown as unavailable until the administrator changes it.

Provider location is explicitly **Local**, **Remote**, **User classified**, or **Unknown**. A private-looking hostname is not enough to silently classify or reclassify a provider. Remote configuration shows this warning:

> Information sent to this provider may leave your local network. Mixarr will limit data to the fields required by the selected AI feature, but the provider may process that information according to its own terms and privacy policy.

Health checks run only when global AI, the provider, and its health-check setting are enabled and the interval/backoff allows it. Failures increase the next delay. Provider failure never changes the main application liveness/readiness result.

## Timeouts, retries, streams, cancellation, and fallback

Provider, global, request, connection-test, discovery, stream-byte, and total stream-duration limits are bounded server-side. Abort signals stop fetches and streams, prevent retries, release readers, and record cancellation distinctly from provider failure.

Authentication, permissions, invalid input, unsupported capabilities, cancellation, disabled state, budgets, response-size failures, and structured-validation failures are not retried. Temporary connection failures, HTTP 408/429/500/502/503/504, and overload may retry within provider limits. Retry-After is honored when numeric, and exponential delay includes jitter.

Fallback is off unless the request and saved feature/provider configuration explicitly allow it. A local provider never silently falls back to a remote provider. Future features must opt into and explain any remote fallback before coordinator support is enabled.

## Usage, cost, budgets, and audit

Safe audit rows store identifiers, status, provider/model display metadata, timing, retries, streaming/cancellation, usage tokens, response byte count, cost if returned, sanitized error category/code, user ID when available, safe metadata, and an optional one-way prompt hash. They do not store prompts, responses, headers, credentials, Plex tokens, private library rows, or raw provider bodies/errors.

Cost is shown only when reported by the provider and is otherwise **Cost data unavailable**. Local providers show **Local provider — API cost not tracked**. Mixarr does not invent model prices. A configured provider monthly budget blocks further requests once recorded estimated/reported cost reaches it; Mixarr does not switch providers unless fallback is explicitly configured.

Audit retention uses configurable days, excludes active records, deletes in bounded batches, and logs only a cleanup summary.

## Docker networking and troubleshooting

From a container, `localhost` points to the container. To reach Ollama or LM Studio on the Docker host, use the host gateway supported by your platform, commonly:

```text
http://host.docker.internal:11434
http://host.docker.internal:1234/v1
```

On Linux engines that do not provide that hostname automatically, add a Compose host-gateway mapping and then use the same hostname:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

For connection failures, verify the base URL, container routing, server bind address, firewall, selected authentication style, and that the discovery/chat endpoints match the server. For TLS failures, install the correct CA chain in the container. Keep SSL verification enabled in production; the saved compatibility switch is visible but the built-in fetch transport does not bypass certificate verification.

For empty discovery results, enter a model identifier manually and confirm the server exposes model listing. If a configured model disappears, Mixarr retains it and warns instead of silently selecting another. Connection tests use no library metadata and normal settings pages never display raw provider bodies.

## Security boundary confirmation

There is no AI completion route that mutates application state in v2.4.0. AI cannot add, remove, unlock, create, regenerate, approve, schedule, or alter a playlist or recipe. No real API key is included in source, fixtures, examples, migration output, or documentation.
