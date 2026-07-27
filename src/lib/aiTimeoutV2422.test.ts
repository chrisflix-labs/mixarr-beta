import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_AI_TIMEOUT_POLICY,
  resolveEffectiveTimeoutPolicy,
  validateAiTimeoutValue,
} from "../ai/config/timeout";
import { createAiTimeoutRuntime } from "../ai/utilities/cancellation";
import { providerFetch } from "../ai/providers/http";
import { createServer } from "node:http";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const unlimited = {
  connectionTimeoutMs: null,
  firstTokenTimeoutMs: null,
  totalRequestTimeoutMs: null,
  streamingIdleTimeoutMs: null,
  cancellationGraceMs: 100,
} as const;

describe("v2.4.22 timeout policy resolution and validation", () => {
  it("lets an enabled provider override replace, rather than tighten, the global policy", () => {
    const policy = resolveEffectiveTimeoutPolicy({
      globalPolicy: { ...DEFAULT_AI_TIMEOUT_POLICY, firstTokenTimeoutMs: 30_000 },
      providerOverrideEnabled: true,
      providerPolicy: { ...DEFAULT_AI_TIMEOUT_POLICY, firstTokenTimeoutMs: 600_000, totalRequestTimeoutMs: null },
    });
    assert.equal(policy.firstTokenTimeoutMs, 600_000);
    assert.equal(policy.totalRequestTimeoutMs, null);
    assert.equal(policy.sources.firstTokenTimeoutMs, "provider");
  });

  it("inherits global values when provider override is disabled", () => {
    const policy = resolveEffectiveTimeoutPolicy({
      globalPolicy: { ...DEFAULT_AI_TIMEOUT_POLICY, streamingIdleTimeoutMs: null },
      providerOverrideEnabled: false,
      providerPolicy: { ...DEFAULT_AI_TIMEOUT_POLICY, streamingIdleTimeoutMs: 1 },
    });
    assert.equal(policy.streamingIdleTimeoutMs, null);
    assert.equal(policy.sources.streamingIdleTimeoutMs, "global");
  });

  it("gives an explicit request override highest precedence, including null", () => {
    const policy = resolveEffectiveTimeoutPolicy({
      requestOverride: { totalRequestTimeoutMs: null },
      providerOverrideEnabled: true,
      providerPolicy: DEFAULT_AI_TIMEOUT_POLICY,
      globalPolicy: DEFAULT_AI_TIMEOUT_POLICY,
    });
    assert.equal(policy.totalRequestTimeoutMs, null);
    assert.equal(policy.sources.totalRequestTimeoutMs, "request");
  });

  it("rejects zero, negative, fractional, and overflowing finite values", () => {
    for (const value of [0, -1, 1.5, 2_147_483_648]) assert.throws(() => validateAiTimeoutValue(value));
    assert.equal(validateAiTimeoutValue(null), null);
    assert.equal(validateAiTimeoutValue(86_400_000), 86_400_000);
  });

  it("preserves null through JSON API-shaped serialization", () => {
    const serialized = JSON.parse(JSON.stringify({ ...DEFAULT_AI_TIMEOUT_POLICY, firstTokenTimeoutMs: null }));
    assert.equal(serialized.firstTokenTimeoutMs, null);
  });
});

describe("v2.4.22 timeout lifecycle", () => {
  it("enforces a finite connection timeout", async () => {
    const timed = createAiTimeoutRuntime({ policy: { ...unlimited, connectionTimeoutMs: 8 }, streaming: false });
    await delay(15);
    assert.equal(timed.timeoutPhase(), "connection");
    assert.equal(timed.error().category, "AI_CONNECTION_TIMEOUT");
    timed.close();
  });

  it("creates no automatic connection expiry when connection is Unlimited", async () => {
    const timed = createAiTimeoutRuntime({ policy: unlimited, streaming: false });
    await delay(15);
    assert.equal(timed.signal.aborted, false);
    timed.close();
  });

  it("counts slow local model loading as first-token time after transport connection", async () => {
    const server = createServer((_request, response) => setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"message":{"content":"ok"}}');
    }, 25));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address.");
    const timed = createAiTimeoutRuntime({ policy: { ...unlimited, connectionTimeoutMs: 10, firstTokenTimeoutMs: 60 }, streaming: false });
    try {
      const response = await providerFetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", body: "{}" }, timed.lifecycle);
      timed.lifecycle.responseActivity({ meaningful: true });
      assert.equal(response.status, 200);
      assert.equal(timed.signal.aborted, false);
    } finally {
      timed.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("allows an unlimited first-token model load and classifies finite expiry exactly", async () => {
    const unlimitedFirst = createAiTimeoutRuntime({ policy: unlimited, streaming: false });
    unlimitedFirst.lifecycle.connectionEstablished();
    await delay(12);
    assert.equal(unlimitedFirst.signal.aborted, false);
    unlimitedFirst.close();

    const finiteFirst = createAiTimeoutRuntime({ policy: { ...unlimited, firstTokenTimeoutMs: 8 }, streaming: false });
    finiteFirst.lifecycle.connectionEstablished();
    await delay(15);
    assert.equal(finiteFirst.error({ provider_type: "ollama" }).category, "AI_FIRST_TOKEN_TIMEOUT");
    assert.match(finiteFirst.error({ provider_type: "ollama" }).toSafePayload().message, /loading into memory/i);
    finiteFirst.close();
  });

  it("does not start streaming idle before first content and resets it after valid activity", async () => {
    const timed = createAiTimeoutRuntime({ policy: { ...unlimited, streamingIdleTimeoutMs: 15 }, streaming: true });
    timed.lifecycle.connectionEstablished();
    await delay(22);
    assert.equal(timed.signal.aborted, false);
    timed.lifecycle.responseActivity({ meaningful: true });
    await delay(9);
    timed.lifecycle.responseActivity({ meaningful: false });
    await delay(9);
    assert.equal(timed.signal.aborted, false);
    await delay(10);
    assert.equal(timed.timeoutPhase(), "stream_idle");
    assert.equal(timed.error().category, "AI_STREAM_IDLE_TIMEOUT");
    timed.close();
  });

  it("allows unlimited stream pauses and enforces finite total request duration", async () => {
    const idleUnlimited = createAiTimeoutRuntime({ policy: unlimited, streaming: true });
    idleUnlimited.lifecycle.connectionEstablished();
    idleUnlimited.lifecycle.responseActivity({ meaningful: true });
    await delay(15);
    assert.equal(idleUnlimited.signal.aborted, false);
    idleUnlimited.close();

    const total = createAiTimeoutRuntime({ policy: { ...unlimited, totalRequestTimeoutMs: 8 }, streaming: false });
    await delay(15);
    assert.equal(total.error().category, "AI_TOTAL_TIMEOUT");
    total.close();
  });

  it("keeps every unlimited request manually cancellable and force-cleans after grace", async () => {
    let forced = false;
    const upstream = new AbortController();
    const timed = createAiTimeoutRuntime({ upstream: upstream.signal, policy: { ...unlimited, cancellationGraceMs: 8 }, streaming: false });
    timed.lifecycle.registerForceCleanup(() => { forced = true; });
    upstream.abort("user cancellation");
    await delay(2);
    assert.equal(timed.error().category, "AI_REQUEST_CANCELLED");
    await delay(12);
    assert.equal(forced, true);
    timed.close();
  });
});

describe("v2.4.22 persistence, UI, worker, and documentation contracts", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("ships nullable persistence, disabled existing-provider overrides, and audit snapshots", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/20260811010000_ai_local_model_timeouts_v2422/migration.sql");
    assert.match(schema, /connectionTimeoutMs\s+Int\?/);
    assert.match(schema, /timeoutOverrideEnabled\s+Boolean\s+@default\(false\)/);
    assert.match(schema, /effectiveTimeoutPolicyJson\s+Json\?/);
    assert.match(migration, /RAISE WARNING/);
    assert.match(migration, /DROP NOT NULL/);
  });

  it("offers explicit Limited and Unlimited modes, human durations, presets, and effective previews", () => {
    const governance = read("src/components/AiGovernanceDashboard.tsx");
    const providers = read("src/components/AiProviderDashboard.tsx");
    for (const marker of ["Limited", "Unlimited — timeout disabled.", "readableDuration", "connectionTimeoutMs", "firstTokenTimeoutMs", "streamingIdleTimeoutMs"]) assert.match(governance, new RegExp(marker));
    assert.match(providers, /Local model — slow initial load/);
    assert.match(providers, /Local model — no request timeout/);
    assert.match(providers, /Effective timeout policy/);
    assert.match(providers, /firstTokenTimeoutMs: kind === "slow" \? 600_000 : null/);
  });

  it("removes hidden stream caps and keeps background heartbeats independent of request age", () => {
    const coordinator = read("src/ai/request-coordinator/index.ts");
    const worker = read("src/ai/queue/worker.ts");
    assert.doesNotMatch(coordinator, /AI_MAX_STREAM_DURATION_MS|AI_STREAM_IDLE_TIMEOUT_MS/);
    assert.match(worker, /setInterval/);
    assert.match(worker, /heartbeatAiJob/);
    assert.match(read("src/ai/queue/service.ts"), /leaseExpiresAt/);
  });

  it("documents Ollama loading, precedence, cancellation, and external infrastructure limits", () => {
    const docs = read("docs/AI_LOCAL_MODEL_TIMEOUTS_V2422.md");
    assert.match(docs, /Ollama times out while loading a model/);
    assert.match(docs, /First-token timeout covers/);
    assert.match(docs, /manually cancellable/);
    assert.match(docs, /Reverse proxies/);
    assert.equal(JSON.parse(read("package.json")).version, "2.4.22");
  });
});
