export type CopyFailureReason = "not-supported" | "not-allowed" | "not-secure-context" | "unknown";

export type CopyResult =
  | { ok: true; method: "clipboard-api" | "legacy-copy" }
  | { ok: false; reason: CopyFailureReason; error?: unknown };

export class ClipboardCopyError extends Error {
  readonly code = "CLIPBOARD_COPY_FAILED";

  constructor(readonly result: Extract<CopyResult, { ok: false }> = { ok: false, reason: "unknown" }) {
    super(result.reason === "not-secure-context"
      ? "Automatic clipboard access is unavailable in this browser context."
      : "The browser blocked automatic copying.");
    this.name = "ClipboardCopyError";
  }
}

type ClipboardNavigator = {
  clipboard?: { writeText?: (text: string) => Promise<void> };
  userAgent?: string;
  // Included only to make it explicit that callers may provide a Permissions
  // API in tests. Copying intentionally never queries or gates on it.
  permissions?: { query?: (...args: any[]) => Promise<unknown> };
};

type ClipboardDocument = Pick<Document, "body" | "createElement" | "execCommand">;

export type ClipboardEnvironment = {
  navigator?: ClipboardNavigator;
  document?: ClipboardDocument;
  secureContext?: boolean;
  logDiagnostic?: (event: string, details: Record<string, unknown>) => void;
};

function errorName(error: unknown) {
  return error && typeof error === "object" && "name" in error ? String(error.name) : undefined;
}

function classifyFailure(secureContext: boolean | undefined, clipboardApiAvailable: boolean, error?: unknown): CopyFailureReason {
  if (secureContext === false) return "not-secure-context";
  if (!clipboardApiAvailable) return "not-supported";
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "SecurityError") return "not-allowed";
  return "unknown";
}

/**
 * Deprecated browser copy command, used only after the async Clipboard API is
 * unavailable or rejects. The temporary control never contains anything other
 * than the caller-provided text and is removed before this function returns.
 */
export function legacyCopyText(text: string, browserDocument: ClipboardDocument | undefined) {
  if (!browserDocument?.body || !browserDocument.createElement || typeof browserDocument.execCommand !== "function") return false;

  const textarea = browserDocument.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.setAttribute("tabindex", "-1");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  browserDocument.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return browserDocument.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Attempts the real clipboard write first, then the legacy user-gesture
 * fallback. The actual write is authoritative; the Permissions API is never a
 * prerequisite because browser implementations disagree about clipboard-write.
 */
export async function tryCopyTextToClipboard(text: string, environment: ClipboardEnvironment = {}): Promise<CopyResult> {
  const browserNavigator = environment.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  const browserDocument = environment.document ?? (typeof document === "undefined" ? undefined : document);
  const secureContext = environment.secureContext ?? (typeof window === "undefined" ? undefined : window.isSecureContext);
  const writeText = browserNavigator?.clipboard?.writeText;
  const clipboardApiAvailable = typeof writeText === "function";
  let clipboardError: unknown;

  if (writeText) {
    try {
      // Preserve the method's receiver for browser implementations that depend
      // on `this` being navigator.clipboard.
      await writeText.call(browserNavigator.clipboard, text);
      return { ok: true, method: "clipboard-api" };
    } catch (error) {
      clipboardError = error;
    }
  }

  if (legacyCopyText(text, browserDocument)) return { ok: true, method: "legacy-copy" };

  const result: CopyResult = {
    ok: false,
    reason: classifyFailure(secureContext, clipboardApiAvailable, clipboardError),
    ...(clipboardError === undefined ? {} : { error: clipboardError }),
  };
  const details = {
    method: "clipboard-api+legacy-copy",
    secureContext: secureContext ?? "unknown",
    clipboardApiAvailable,
    browser: browserNavigator?.userAgent || "unknown",
    errorName: errorName(clipboardError) || "none",
  };
  if (environment.logDiagnostic) environment.logDiagnostic("clipboard.copy.failed", details);
  else if (typeof window !== "undefined") console.debug("clipboard.copy.failed", details);
  return result;
}

/** Backward-compatible throwing wrapper for existing copy controls. */
export async function copyTextToClipboard(text: string, environment: ClipboardEnvironment = {}) {
  const result = await tryCopyTextToClipboard(text, environment);
  if (!result.ok) throw new ClipboardCopyError(result);
  return result.method;
}
