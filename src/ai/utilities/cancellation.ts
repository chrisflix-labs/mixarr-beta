import { AiError } from "../errors";

type AiCancellationRuntime = { controllers: Set<AbortController>; shutdownHandlersAttached: boolean };
declare global { var mixarrAiCancellationRuntime: AiCancellationRuntime | undefined; }
const runtime = globalThis.mixarrAiCancellationRuntime ?? { controllers: new Set<AbortController>(), shutdownHandlersAttached: false };
globalThis.mixarrAiCancellationRuntime = runtime;

export function cancelAllAiRequests() { for (const controller of Array.from(runtime.controllers)) controller.abort("Application shutdown cancelled the AI request."); }
if (typeof process !== "undefined" && !runtime.shutdownHandlersAttached) {
  runtime.shutdownHandlersAttached = true;
  process.once("SIGTERM", cancelAllAiRequests);
  process.once("SIGINT", cancelAllAiRequests);
}

export function createAiRequestSignal(upstream: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController(); runtime.controllers.add(controller); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort("AI request timeout."); }, timeoutMs);
  const cancel = () => controller.abort(upstream?.reason || "AI request cancelled."); upstream?.addEventListener("abort", cancel, { once: true });
  return { signal: controller.signal, timedOut: () => timedOut, abort: () => controller.abort(), close: () => { clearTimeout(timer); upstream?.removeEventListener("abort", cancel); runtime.controllers.delete(controller); } };
}

export async function nextStreamEvent<T>(iterator: AsyncIterator<T>, idleTimeoutMs: number, abort: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_resolve, reject) => { timer = setTimeout(() => { abort(); reject(new AiError("STREAM_INTERRUPTED", "The provider stream exceeded its idle timeout.")); }, idleTimeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
