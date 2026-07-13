import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { betaApiError } from "@/lib/betaApi";
import { recordBetaUsage, requireFeature } from "@/lib/featureFlagService";
import { generatePlaylistTracksWithStats, playlistConfigSchema } from "@/lib/playlistService";
import { getScoringModel } from "@/lib/scoringModels";

function identity(track: any) { return String(track?.id || track?.ratingKey || track?.plexId || ""); }
function variety(tracks: any[], field: "artist" | "album") {
  return new Set(tracks.map((track) => String(track?.[field]?.title || track?.[`${field}Title`] || "").trim().toLowerCase()).filter(Boolean)).size;
}
function resultSummary(result: Awaited<ReturnType<typeof generatePlaylistTracksWithStats>>, durationMs: number) {
  const score = result.qualityScore as any;
  return {
    scoringModel: result.scoringModel,
    scoringModelVersion: result.scoringModelVersion,
    overallScore: score?.overallScore ?? null,
    moodScore: score?.moodScore ?? score?.mood ?? null,
    energyScore: score?.energyScore ?? score?.energy ?? null,
    bpmScore: score?.bpmScore ?? score?.bpmFlow?.score ?? null,
    discoveryScore: score?.discoveryScore ?? score?.discovery ?? null,
    artistVariety: variety(result.tracks, "artist"),
    albumVariety: variety(result.tracks, "album"),
    trackCount: result.tracks.length,
    trackIds: result.tracks.map(identity),
    warnings: result.safety.warnings || [],
    processingTimeMs: durationMs,
  };
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const started = Date.now();
  try {
    await requireFeature("smartMix.compareScoringModels", { userId });
    const body = await request.json();
    const modelA = getScoringModel(body.modelA || "stable-v2");
    const modelB = getScoringModel(body.modelB || "experimental-balanced");
    if (!modelA || !modelB) return NextResponse.json({ error: "SCORING_MODEL_NOT_FOUND" }, { status: 400 });
    for (const model of [modelA, modelB]) if (model.requiredFeature) await requireFeature(model.requiredFeature, { userId });
    const baseConfig = playlistConfigSchema.parse({ ...body.request, engineVersion: "v2", allowStableFallback: false });
    const aStart = Date.now();
    const a = await generatePlaylistTracksWithStats({ userId, config: { ...baseConfig, scoringModel: modelA.id } });
    const aDuration = Date.now() - aStart;
    const bStart = Date.now();
    const b = await generatePlaylistTracksWithStats({ userId, config: { ...baseConfig, scoringModel: modelB.id } });
    const bDuration = Date.now() - bStart;
    const aSummary = resultSummary(a, aDuration);
    const bSummary = resultSummary(b, bDuration);
    const aSet = new Set(aSummary.trackIds);
    const bSet = new Set(bSummary.trackIds);
    const inBoth = aSummary.trackIds.filter((id) => bSet.has(id)).length;
    const differentOrdering = aSummary.trackIds.filter((id, index) => bSummary.trackIds[index] !== id).length;
    await recordBetaUsage({ userId, featureKey: "smartMix.compareScoringModels", action: "model_comparison", success: true, engineVersion: "v2", scoringModel: `${modelA.id}:${modelB.id}`, durationMs: Date.now() - started });
    return NextResponse.json({ saved: false, modelA: aSummary, modelB: bSummary, comparison: { tracksInBoth: inBoth, onlyInA: aSummary.trackIds.filter((id) => !bSet.has(id)), onlyInB: bSummary.trackIds.filter((id) => !aSet.has(id)), differentOrdering, warnings: [...aSummary.warnings, ...bSummary.warnings].filter((warning, index, all) => all.indexOf(warning) === index), processingTimeMs: Date.now() - started } });
  } catch (error) {
    await recordBetaUsage({ userId, featureKey: "smartMix.compareScoringModels", action: "model_comparison", success: false, engineVersion: "v2", errorCode: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN", durationMs: Date.now() - started });
    return betaApiError(error);
  }
}
