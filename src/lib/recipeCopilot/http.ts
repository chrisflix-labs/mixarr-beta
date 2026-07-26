export class RecipeCopilotHttpError extends Error {
  constructor(
    message: string,
    public code = "AI_RECIPE_REQUEST_FAILED",
    public requestId?: string,
    public retryable = false,
    public status?: number,
  ) {
    super(message);
    this.name = "RecipeCopilotHttpError";
  }
}

export async function readRecipeCopilotResponse(response: Response, fallback: string) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const text = response.status === 204 ? "" : await response.text();
  let body: any = null;
  if (contentType.includes("json") && text.trim()) {
    try { body = JSON.parse(text); }
    catch {
      throw new RecipeCopilotHttpError(response.ok ? "Mixarr returned malformed JSON for a successful Recipe Copilot request." : `${fallback} Mixarr returned a malformed JSON error.`, "AI_RECIPE_REQUEST_FAILED", undefined, false, response.status);
    }
  }
  if (!response.ok) {
    const error = body?.error || body || {};
    const requestId = error.requestId || body?.requestId;
    const message = error.message || body?.message || (text.trim() && !contentType.includes("html") ? text.trim().slice(0, 300) : `${fallback} The server returned HTTP ${response.status} without a JSON error body.`);
    throw new RecipeCopilotHttpError(message, error.code || body?.code || "AI_RECIPE_REQUEST_FAILED", requestId, error.retryable === true || body?.retryable === true, response.status);
  }
  if (!contentType.includes("json") || !text.trim() || body == null) throw new RecipeCopilotHttpError("Mixarr returned an empty or non-JSON Recipe Copilot response.", "AI_RECIPE_REQUEST_FAILED", undefined, false, response.status);
  return body;
}
