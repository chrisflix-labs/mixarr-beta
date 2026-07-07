export type RetryType = "BPM" | "audio-feature" | "genre" | "popularity";

export type RetrySkipReasons = Record<string, number>;

export type RetryExplanationInput = {
  retryType: RetryType;
  filter: string;
  matched: number;
  queued: number;
  skipped?: number;
  skipReasons?: RetrySkipReasons;
  mode?: string | null;
};

export type RetryExplanation = {
  summary: string;
  explanation: string | null;
  message: string;
  logReason: string;
};

function count(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function retryLabel(retryType: RetryType) {
  if (retryType === "BPM") return "BPM";
  if (retryType === "audio-feature") return "audio-feature";
  return retryType;
}

function likelyZeroQueueReason(input: Required<Pick<RetryExplanationInput, "retryType" | "matched" | "queued" | "filter">> & {
  mode?: string | null;
  skipReasons?: RetrySkipReasons;
}) {
  if (input.matched === 0) {
    return `No tracks matched the selected filter. Try a different Library Health filter or clear any library selection.`;
  }

  const reasons = input.skipReasons || {};
  const knownReasons = Object.entries(reasons).filter(([, value]) => value > 0).map(([reason]) => reason);
  if (input.retryType === "BPM") {
    if (knownReasons.includes("already_has_local_bpm")) {
      return "Matching tracks already have local BPM data, so the selected retry mode did not queue them.";
    }
    if (knownReasons.includes("not_missing_bpm")) {
      return "Matching tracks already have BPM data, so they are not eligible for this retry mode.";
    }
    if (knownReasons.includes("failed_previous_attempt")) {
      return "Matching tracks already have terminal BPM attempts. Try force local reprocess or a failed-track retry mode.";
    }
    return "All matching tracks already have local BPM data or are not eligible for the selected retry mode.";
  }

  if (input.retryType === "genre") {
    return "Matching tracks already have genre data or are not eligible for the selected retry mode.";
  }

  if (input.retryType === "popularity") {
    return "Matching tracks already have popularity data or are not eligible for the selected retry mode.";
  }

  if (knownReasons.includes("already_has_complete_audio_features")) {
    return "Matching tracks already have complete audio features, so the selected retry mode did not queue them.";
  }
  if (knownReasons.includes("too_short")) {
    return "Matching tracks are marked too short for local audio-feature analysis.";
  }
  if (knownReasons.includes("failed_previous_attempt")) {
    return "Matching tracks already have terminal audio-feature attempts. Try force local reprocess or a failed-track retry mode.";
  }
  return "Matching tracks may already have complete local audio features, may be missing files, may be too short to analyze, or may not match the selected retry mode.";
}

function nextStep(input: RetryExplanationInput) {
  if (input.matched === 0) return "";
  if (input.retryType === "BPM") {
    return " Try force local reprocess, retry missing or failed BPM tracks, or select a different retry mode.";
  }
  if (input.retryType === "genre") return " Try retrying missing genre tracks or select a different filter.";
  if (input.retryType === "popularity") return " Try retrying missing popularity tracks or select a different filter.";
  return " Try force local reprocess, retry missing or partial audio-feature tracks, or select a different retry mode.";
}

export function formatRetrySkipReasons(skipReasons: RetrySkipReasons | undefined) {
  const entries = Object.entries(skipReasons || {}).filter(([, value]) => value > 0);
  return entries.map(([reason, value]) => `${reason}=${value}`).join(", ");
}

export function buildRetryExplanation(input: RetryExplanationInput): RetryExplanation {
  const matched = count(input.matched);
  const queued = count(input.queued);
  const skipped = count(input.skipped ?? matched - queued);
  const label = retryLabel(input.retryType);
  const reasonDetails = formatRetrySkipReasons(input.skipReasons);
  const counts = `matched=${matched}, queued=${queued}, skipped=${skipped}.`;
  const modeText = input.mode ? ` mode=${input.mode}.` : "";

  if (queued > 0) {
    const summary = `Queued ${label} retry for filter ${input.filter}: ${queued} track${queued === 1 ? "" : "s"}. ${counts}`;
    const explanation = reasonDetails ? `Skipped reasons: ${reasonDetails}.` : null;
    return {
      summary,
      explanation,
      message: explanation ? `${summary} ${explanation}` : summary,
      logReason: queued < matched ? "some matching tracks were skipped" : "tracks queued",
    };
  }

  const explanation = likelyZeroQueueReason({
    retryType: input.retryType,
    filter: input.filter,
    matched,
    queued,
    mode: input.mode,
    skipReasons: input.skipReasons,
  });
  const summary = input.retryType === "audio-feature" && matched > 0
    ? `Audio feature retry matched ${matched} track${matched === 1 ? "" : "s"}, queued 0, skipped ${skipped}.`
    : `No ${label} retry jobs were queued for filter ${input.filter}. ${counts}`;
  const reasonSuffix = reasonDetails ? ` Skip reasons: ${reasonDetails}.` : "";
  const message = `${summary} ${explanation}${nextStep({ ...input, matched, queued, skipped })}${reasonSuffix}${modeText}`;
  return {
    summary,
    explanation,
    message,
    logReason: matched === 0 ? "no tracks matched selected filter" : "no eligible tracks for selected retry mode",
  };
}

export function summarizeRetryResult(input: RetryExplanationInput) {
  return buildRetryExplanation(input).summary;
}
