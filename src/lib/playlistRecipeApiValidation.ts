import { NextResponse } from "next/server";
import {
  PlaylistRecipeDraftValidationError,
  type PlaylistRecipeDraftValidationIssue,
} from "./playlistRecipes";

export function playlistRecipeCorrelationId(request: Request) {
  const supplied = request.headers.get("x-correlation-id");
  return supplied && /^[a-zA-Z0-9._:-]{1,120}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export function playlistRecipeValidationResponse(
  issues: PlaylistRecipeDraftValidationIssue[],
  correlationId: string,
) {
  const first = issues[0] || {
    path: "recipe",
    code: "RECIPE_DRAFT_INVALID",
    message: "The recipe draft is invalid.",
  };
  const scoring = first.code === "RECIPE_SCORING_MODEL_UNSUPPORTED";
  console.warn("[Playlist Recipe] Validation rejected", {
    correlationId,
    code: first.code,
    path: first.path,
    ...(scoring ? {
      receivedValue: first.receivedValue,
      supportedValues: first.supportedValues,
    } : {}),
  });
  return NextResponse.json({
    error: {
      code: first.code,
      message: first.message,
      field: first.path,
      ...(first.receivedValue === undefined ? {} : { receivedValue: first.receivedValue }),
      ...(first.supportedValues === undefined ? {} : { supportedValues: first.supportedValues }),
      correlationId,
      issues,
    },
  }, {
    status: 422,
    headers: { "x-correlation-id": correlationId },
  });
}

export function playlistRecipeValidationErrorResponse(error: unknown, correlationId: string) {
  return error instanceof PlaylistRecipeDraftValidationError
    ? playlistRecipeValidationResponse(error.issues, correlationId)
    : null;
}

