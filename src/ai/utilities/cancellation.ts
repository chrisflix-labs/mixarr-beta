import type { AiProviderLifecycle } from "../contracts";
import type { AiTimeoutPolicy } from "../config/timeout";
import { AiError, type AiErrorCategory } from "../errors";

type AiCancellationRuntime = { controllers: Set<AbortController>; providerControllers: Map<string, Set<AbortController>>; shutdownHandlersAttached: boolean };
declare global { var mixarrAiCancellationRuntime: AiCancellationRuntime | undefined; }
const runtime = globalThis.mixarrAiCancellationRuntime ?? { controllers: new Set<AbortController>(), providerControllers: new Map<string, Set<AbortController>>(), shutdownHandlersAttached: false };
runtime.providerControllers ||= new Map<string, Set<AbortController>>();
globalThis.mixarrAiCancellationRuntime = runtime;

export type AiTimeoutPhase = "connection" | "first_token" | "total" | "stream_idle";
const phaseCategory: Record<AiTimeoutPhase, AiErrorCategory> = {
  connection: "AI_CONNECTION_TIMEOUT",
  first_token: "AI_FIRST_TOKEN_TIMEOUT",
  total: "AI_TOTAL_TIMEOUT",
  stream_idle: "AI_STREAM_IDLE_TIMEOUT",
};

export function cancelAllAiRequests() {
  for (const controller of Array.from(runtime.controllers)) controller.abort("Application shutdown cancelled the AI request.");
}
export function cancelAiRequestsForProvider(providerId: string, reason = "AI provider was disabled or deleted.") {
  for (const controller of Array.from(runtime.providerControllers.get(providerId) || [])) controller.abort(reason);
}
if (typeof process !== "undefined" && !runtime.shutdownHandlersAttached) {
  runtime.shutdownHandlersAttached = true;
  process.once("SIGTERM", cancelAllAiRequests);
  process.once("SIGINT", cancelAllAiRequests);
}

type Timer = ReturnType<typeof setTimeout>;
function deadlineTimer(milliseconds: number | null, callback: () => void) {
  if (milliseconds === null) return { clear() {} };
  const deadline = Date.now() + milliseconds;
  let timer: Timer | undefined;
  const schedule = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return callback();
    timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    timer.unref?.();
  };
  schedule();
  return { clear() { if (timer) clearTimeout(timer); timer = undefined; } };
}

export function createAiTimeoutRuntime(input: {
  upstream?: AbortSignal;
  providerId?: string;
  policy: AiTimeoutPolicy;
  streaming: boolean;
  deferConnectionUntilAttempt?: boolean;
  requestStartedAt?: number;
  onLifecycleLog?: (event: Record<string, unknown>) => void;
}) {
  const controller = new AbortController();
  runtime.controllers.add(controller);
  if (input.providerId) {
    const controllers = runtime.providerControllers.get(input.providerId) || new Set<AbortController>();
    controllers.add(controller);
    runtime.providerControllers.set(input.providerId, controllers);
  }
  const startedAt = input.requestStartedAt ?? Date.now();
  const cleanupCallbacks = new Set<() => void>();
  let closed = false;
  let connected = false;
  let firstResponseReceived = false;
  let producedContent = false;
  let timeoutPhase: AiTimeoutPhase | null = null;
  let cancellationResult = "not_cancelled";
  let cancellationInitiated = false;
  let connectionTimer = { clear() {} };
  let firstTokenTimer = { clear() {} };
  let idleTimer = { clear() {} };
  let graceTimer = { clear() {} };
  let totalTimer = { clear() {} };

  const log = (event: string, extra: Record<string, unknown> = {}) => input.onLifecycleLog?.({
    event,
    elapsedMs: Date.now() - startedAt,
    producedTokens: producedContent,
    ...extra,
  });

  const forceCleanup = () => {
    let failures = 0;
    for (const cleanup of Array.from(cleanupCallbacks)) {
      try { cleanup(); } catch { failures += 1; }
    }
    cancellationResult = failures ? "force_cleanup_partial" : "force_cleanup_completed";
    log("ai_timeout_force_cleanup", { cancellationResult, cleanupFailures: failures });
  };

  const initiateCancellation = (reason: string, phase?: AiTimeoutPhase) => {
    if (controller.signal.aborted || closed) return;
    cancellationInitiated = true;
    timeoutPhase = phase || null;
    connectionTimer.clear(); firstTokenTimer.clear(); idleTimer.clear(); totalTimer.clear();
    cancellationResult = "cancellation_initiated";
    log("ai_timeout_cancellation_started", {
      timeoutPhase,
      configuredTimeoutMs: phase === "connection" ? input.policy.connectionTimeoutMs
        : phase === "first_token" ? input.policy.firstTokenTimeoutMs
          : phase === "total" ? input.policy.totalRequestTimeoutMs
            : phase === "stream_idle" ? input.policy.streamingIdleTimeoutMs
              : undefined,
    });
    controller.abort(reason);
    graceTimer = deadlineTimer(input.policy.cancellationGraceMs, forceCleanup);
  };

  // Provider disablement/deletion and application shutdown abort registered
  // controllers directly. These paths still receive the finite cleanup grace.
  controller.signal.addEventListener("abort", () => {
    if (cancellationInitiated || closed) return;
    cancellationInitiated = true;
    timeoutPhase = null;
    connectionTimer.clear(); firstTokenTimer.clear(); idleTimer.clear(); totalTimer.clear();
    cancellationResult = "cancellation_initiated";
    log("ai_timeout_cancellation_started", { timeoutPhase: null });
    graceTimer = deadlineTimer(input.policy.cancellationGraceMs, forceCleanup);
  }, { once: true });

  const armIdle = () => {
    idleTimer.clear();
    idleTimer = deadlineTimer(input.streaming ? input.policy.streamingIdleTimeoutMs : null, () => initiateCancellation("AI streaming idle timeout.", "stream_idle"));
  };

  const lifecycle: AiProviderLifecycle = {
    connectionEstablished() {
      if (closed || connected) return;
      connected = true;
      connectionTimer.clear();
      log("ai_connection_established");
      firstTokenTimer = deadlineTimer(input.policy.firstTokenTimeoutMs, () => initiateCancellation("AI first-token timeout.", "first_token"));
    },
    responseActivity(options) {
      if (closed) return;
      if (!connected) lifecycle.connectionEstablished();
      if (options?.meaningful === false) {
        if (firstResponseReceived) armIdle();
        return;
      }
      if (!firstResponseReceived) {
        firstResponseReceived = true;
        firstTokenTimer.clear();
        log("ai_first_content_received");
      }
      if (options?.producedOutput !== false) producedContent = true;
      armIdle();
    },
    registerForceCleanup(cleanup) {
      cleanupCallbacks.add(cleanup);
      return () => {
        cleanupCallbacks.delete(cleanup);
        if (controller.signal.aborted && cancellationResult === "cancellation_initiated" && cleanupCallbacks.size === 0) {
          graceTimer.clear();
          cancellationResult = "cooperative_cleanup_completed";
          log("ai_timeout_cooperative_cleanup", { cancellationResult });
        }
      };
    },
  };

  const elapsedBeforeRuntime = Math.max(0, Date.now() - startedAt);
  const remainingTotal = input.policy.totalRequestTimeoutMs === null ? null : Math.max(0, input.policy.totalRequestTimeoutMs - elapsedBeforeRuntime);
  totalTimer = deadlineTimer(remainingTotal, () => initiateCancellation("AI total request timeout.", "total"));
  connectionTimer = deadlineTimer(input.deferConnectionUntilAttempt ? null : input.policy.connectionTimeoutMs, () => initiateCancellation("AI connection timeout.", "connection"));
  const upstreamCancel = () => initiateCancellation(String(input.upstream?.reason || "AI request cancelled."));
  input.upstream?.addEventListener("abort", upstreamCancel, { once: true });

  return {
    signal: controller.signal,
    lifecycle,
    beginAttempt() {
      if (closed || controller.signal.aborted) return;
      connectionTimer.clear(); firstTokenTimer.clear(); idleTimer.clear();
      connected = false;
      firstResponseReceived = false;
      connectionTimer = deadlineTimer(input.policy.connectionTimeoutMs, () => initiateCancellation("AI connection timeout.", "connection"));
    },
    timedOut: () => timeoutPhase !== null,
    timeoutPhase: () => timeoutPhase,
    producedContent: () => producedContent,
    cancellationResult: () => cancellationResult,
    abort: (reason = "AI request cancelled.") => initiateCancellation(reason),
    error(details: Record<string, unknown> = {}) {
      const category = timeoutPhase ? phaseCategory[timeoutPhase] : "AI_REQUEST_CANCELLED";
      return new AiError(category, undefined, timeoutPhase ? 504 : 499, undefined, {
        ...details,
        timeout_phase: timeoutPhase,
        elapsed_ms: Date.now() - startedAt,
        produced_tokens: producedContent,
        cancellation_result: cancellationResult,
      });
    },
    close() {
      if (closed) return;
      closed = true;
      connectionTimer.clear(); firstTokenTimer.clear(); idleTimer.clear(); totalTimer.clear(); graceTimer.clear();
      input.upstream?.removeEventListener("abort", upstreamCancel);
      runtime.controllers.delete(controller);
      if (input.providerId) {
        const controllers = runtime.providerControllers.get(input.providerId);
        controllers?.delete(controller);
        if (!controllers?.size) runtime.providerControllers.delete(input.providerId);
      }
      cleanupCallbacks.clear();
    },
  };
}

/** Backward-compatible total-only controller for non-provider administrative work. */
export function createAiRequestSignal(upstream: AbortSignal | undefined, timeoutMs: number | null) {
  const timed = createAiTimeoutRuntime({
    upstream,
    streaming: false,
    policy: {
      connectionTimeoutMs: null,
      firstTokenTimeoutMs: null,
      totalRequestTimeoutMs: timeoutMs,
      streamingIdleTimeoutMs: null,
      cancellationGraceMs: 2_000,
    },
  });
  return {
    signal: timed.signal,
    timedOut: timed.timedOut,
    abort: timed.abort,
    close: timed.close,
  };
}

/** @deprecated Streaming requests use lifecycle-driven idle timers. */
export async function nextStreamEvent<T>(iterator: AsyncIterator<T>, idleTimeoutMs: number | null, abort: () => void) {
  if (idleTimeoutMs === null) return iterator.next();
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort();
          reject(new AiError("STREAM_INTERRUPTED", "The provider stream exceeded its idle timeout."));
        }, idleTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
