export class ClipboardCopyError extends Error {
  readonly code = "CLIPBOARD_COPY_FAILED";

  /**
   * The message stays generic so every caller can state what *was* produced
   * before the copy failed. Only the copy failed; the value the caller asked
   * for still exists and is still on screen.
   */
  constructor() {
    super("The browser denied clipboard access.");
    this.name = "ClipboardCopyError";
  }
}

type ClipboardEnvironment = {
  navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
  document?: Pick<Document, "body" | "createElement" | "execCommand">;
};

/** Uses the async Clipboard API first and a short-lived textarea fallback only when needed. */
export async function copyTextToClipboard(text: string, environment: ClipboardEnvironment = {}) {
  const browserNavigator = environment.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  const browserDocument = environment.document ?? (typeof document === "undefined" ? undefined : document);
  if (browserNavigator?.clipboard?.writeText) {
    try {
      await browserNavigator.clipboard.writeText(text);
      return "clipboard_api" as const;
    } catch {
      // Permission-denied and non-secure-context failures may still allow the
      // browser's legacy user-gesture copy command below.
    }
  }
  if (browserDocument?.body && browserDocument.createElement && browserDocument.execCommand) {
    const textarea = browserDocument.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    browserDocument.body.appendChild(textarea);
    try {
      textarea.focus();
      textarea.select();
      if (browserDocument.execCommand("copy")) return "exec_command" as const;
    } catch {
      // The typed clipboard error below is intentionally distinct from export validation.
    } finally {
      textarea.remove();
    }
  }
  throw new ClipboardCopyError();
}
