# Mixarr v2.4.10 — AI-Assisted Mix Intelligence Polish

## Overview

`/ai` is the primary AI entry point for authenticated Mixarr users. It summarizes only persisted application data: whether AI is enabled, privacy mode, active provider and model, fallback configuration, provider health, Ollama status, request and token usage, estimated external cost, budget utilization, queue state, approvals, warnings, enabled features, and recent outcomes.

AI remains optional. Mixarr’s deterministic recipe engine, filtering, scoring, validation, spacing, deduplication, availability checks, ordering, permissions, and approval workflows remain authoritative. Provider output is an untrusted proposal and cannot execute code, write metadata, modify the database directly, approve itself, or apply a recipe.

## Guided setup

Administrators can run or resume the ten-step setup from `/ai`:

1. Review what AI can and cannot do.
2. Choose local-only or external-provider processing.
3. Select an already configured provider.
4. Choose a discovered available model.
5. Review a privacy mode and approximate sanitized payload.
6. Configure backend-enforced budget, request, token, and per-request cost limits.
7. Opt into individual implemented features.
8. Run a minimal provider inference test. No library metadata is included; an external test may incur a provider charge.
9. Generate and review a recipe draft in Ask Mixarr.
10. Review the final configuration and approval boundary before activation.

Progress is saved after every completed step. Saving or leaving the wizard does not activate AI. Activation validates that the provider is saved, enabled, approved, healthy, correctly classified for local-only mode, and has the selected model available. It also verifies privacy and cost acknowledgments and a reviewed recipe draft. Global AI enablement occurs last.

## Providers and Ollama

Mixarr exposes only providers implemented by the shared provider registry: Ollama, LiteLLM, LM Studio, DeepSeek, OpenAI API, generic OpenAI-compatible APIs, OpenRouter, and Anthropic. ChatGPT consumer subscriptions are not API credentials.

For Ollama:

- Same Docker Compose project: commonly `http://ollama:11434`.
- Ollama on a Windows or macOS Docker Desktop host: commonly `http://host.docker.internal:11434`.
- Mixarr outside Docker: `http://127.0.0.1:11434` may be appropriate.
- Separate container: use a shared Docker network and resolvable container/service name.
- Another LAN device: use its reachable address and verify Ollama’s bind address, host firewall, routing, DNS, and TLS certificate when HTTPS is used.

When Mixarr runs in a container, `localhost` refers to the Mixarr container, not the Docker host. Availability always comes from an actual credential, discovery, or inference health result; the UI does not invent health, pricing, or capabilities.

## Privacy modes

- **Local Only** permits only an administrator-confirmed local provider. Credentials, authorization data, user and household identifiers, paths, server addresses, private notes, and unrelated metadata are still removed.
- **Metadata Limited** shares only allowlisted feature-relevant music fields. Listening history, usernames, household data, paths, private notes, and infrastructure identifiers remain prohibited.
- **Anonymous Metadata** uses generalized ranges and aggregates where the feature supports them.
- **Full Metadata** may share administrator-approved music metadata after the versioned warning is accepted. It never permits secrets, paths, user/household identity, private notes, or infrastructure data.

Free-form request text is shown in preflight before submission. Changing privacy policy creates an administrative audit event.

## Cost, usage, caching, and deduplication

Global, provider, user, request, token, retry, fallback, concurrency, and queue controls are enforced on the backend. Atomic budget reservations prevent accepted concurrent requests from exceeding configured spending. Paid fallback is off by default and is reevaluated against current privacy, permission, model, and budget policy.

Usage distinguishes provider-reported values from estimates. Request details expose recorded input, output, cached, and reasoning tokens, cost, queue duration, provider duration, retries, fallback, and block reasons when available. Prompt caching is used only by adapters that explicitly support it and remains scoped by household/privacy context. Durable jobs and request fingerprints prevent duplicate active work and duplicate provider charges.

## Request templates and history

The Requests tab provides permission-scoped natural-language request history with provider, model, privacy, status, token, cost, approval, linked result, revision, and error information. Values not retained by the configured retention policy are labeled unavailable rather than reconstructed.

Templates support names, descriptions, `{{variables}}`, owner, private or household visibility, default routing metadata, last use, and usage count. Variables must be supplied exactly before rendering. Rendering never contacts a provider; users continue to Ask Mixarr to review current privacy and cost preflight. Household templates still use the requesting user’s permissions and limits.

## Recipe, explanation, metadata, and troubleshooting centers

- Ask Mixarr and Recipe Studio preserve original requests, generated and human-edited revisions, validation, candidate estimates, approval, provider/model provenance, and applied results.
- Explanations distinguish deterministic Mixarr facts, configured rules, AI interpretations, provider failures, and uncertain estimates.
- Metadata suggestions remain advisory. Single and bulk decisions require permission and confirmation; `AI_METADATA_WRITES_ENABLED=false` is a hard boundary.
- Troubleshooting runs deterministic checks first. External AI receives only the explicitly previewed sanitized diagnostic bundle, never full logs automatically.

## Feedback and household access

Thumbs feedback is stored inside Mixarr and linked to request, result, feature, provider, model, and recipe version when available. It is not forwarded to an AI provider. Non-administrators see only their own request activity. Administrative request visibility, provider use, external/local access, limits, feature access, templates, approval permissions, and analytics remain governed by backend permissions.

## Security and reliability

The shared v2.4.x coordinator provides centralized redaction, prompt boundaries, injection checks, strict structured schemas, bounded local repair, response quarantine, provider failover policy, durable leases, heartbeats, stale recovery, cancellation, retry backoff, per-provider isolation, and emergency shutdown. Large-library features deterministically prefilter, aggregate, sample, chunk, and estimate context before provider submission; a full library is never sent.

See also:

- [AI Provider Foundation](AI_PROVIDER_FOUNDATION_V240.md)
- [AI Governance and Cost Controls](AI_GOVERNANCE_V241.md)
- [AI Governance, Security and Reliability](AI_GOVERNANCE_SECURITY_RELIABILITY_V249.md)
- [Natural-Language Requests](NATURAL_LANGUAGE_PLAYLIST_REQUESTS_V242.md)
- [Recipe Copilot](RECIPE_COPILOT_V244.md)
- [Metadata Suggestions](AI_PLAYLIST_SUMMARIES_METADATA_SUGGESTIONS_V246.md)
- [Explainable Recommendations](EXPLAINABLE_AI_RECOMMENDATIONS_V247.md)
- [AI-Assisted Troubleshooting](AI_ASSISTED_TROUBLESHOOTING_V248.md)

## Migration and backup

Apply `20260728010000_ai_intelligence_polish_v2410`. It creates `AiOnboardingProgress`, `AiRequestTemplate`, and `AiQualityFeedback` with inert defaults and cascade ownership. It does not enable AI, providers, models, external processing, paid fallback, or metadata writes.

Backups should include the three new tables along with existing provider configuration, encrypted credentials when the deployment supports secret restoration, models, privacy/cost/household policy, requests, recipe history, suggestions, audits, approvals, feedback, and usage. Do not restore queue leases or worker ownership. After restore, provider health must be treated as unknown until retested and interrupted work must be recovered without duplicate execution.

## API additions

- `GET /api/ai/dashboard`
- `GET|PATCH|POST /api/ai/onboarding`
- `GET /api/ai/request-history`
- `GET|POST /api/ai/templates`
- `PATCH|DELETE /api/ai/templates/{id}`
- `POST /api/ai/templates/{id}/render`
- `POST /api/ai/feedback`

All routes require an authenticated Mixarr user. Onboarding is administrator-only. Responses never return provider credentials, authorization headers, cookies, or encrypted secret payloads.
