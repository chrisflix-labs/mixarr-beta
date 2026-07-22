import { NextResponse } from "next/server";
import { getRecommendationExplanation, recordRecommendationExplanationAudit } from "@/lib/recommendationExplanations/service";
import { previewGeneratedPlaylistRegeneration, regenerateGeneratedPlaylistFromPreview } from "@/lib/playlistService";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const userId = recommendationExplanationUserId(), body = await request.json().catch(() => ({}));
    if (body.reinterpret === true) { const current = await getRecommendationExplanation(userId, params.id); if (!current.legacy) await recordRecommendationExplanationAudit(userId, params.id, "REINTERPRETATION_REQUESTED", { forwardedToAi: false }); throw Object.assign(new Error("Reinterpretation is a separate, explicit AI Recipe Copilot request. Deterministic regeneration never calls AI."), { code: "REINTERPRETATION_REQUIRED", status: 409 }); }
    const explanation = await getRecommendationExplanation(userId, params.id);
    const audit = async (eventType: string, details: unknown) => { if (!explanation.legacy) await recordRecommendationExplanationAudit(userId, params.id, eventType, details); };
    await audit("DETERMINISTIC_REGENERATION_STARTED", { apply: body.apply === true, aiCalled: false });
    if (!explanation.generatedPlaylistId) { const result = { aiCalled: false, mode: body.mode || "stored_recipe", generatedConfiguration: explanation.generatedConfiguration, reproducibility: explanation.reproducibility, message: "The stored structured configuration is ready for deterministic use; no generated playlist is linked yet." }; await audit("DETERMINISTIC_REGENERATION_COMPLETED", { applied: false, aiCalled: false, playlistLinked: false }); return NextResponse.json(result); }
    if (body.apply === true) {
      if (!Array.isArray(body.trackIds) || !body.trackIds.length) throw Object.assign(new Error("Apply requires trackIds from a deterministic regeneration preview."), { code: "REGENERATION_PREVIEW_REQUIRED", status: 400 });
      const result = await regenerateGeneratedPlaylistFromPreview({ userId, generatedPlaylistId: explanation.generatedPlaylistId, trackIds: body.trackIds, previewId: body.previewId || null, mode: body.playlistMode || "replace_all", keepPercent: body.keepPercent == null ? null : Number(body.keepPercent), preferDifferentTracks: Boolean(body.preferDifferentTracks), regeneration: body.regeneration || null, warnings: Array.isArray(body.warnings) ? body.warnings : [] });
      await audit("DETERMINISTIC_REGENERATION_COMPLETED", { applied: true, aiCalled: false, trackCount: body.trackIds.length });
      return NextResponse.json({ ...result, aiCalled: false });
    }
    const preview = await previewGeneratedPlaylistRegeneration({ userId, generatedPlaylistId: explanation.generatedPlaylistId, mode: body.playlistMode || "replace_all", keepPercent: Number(body.keepPercent || 25), preferDifferentTracks: Boolean(body.preferDifferentTracks) });
    await audit("DETERMINISTIC_REGENERATION_COMPLETED", { applied: false, aiCalled: false, previewId: preview.preview.previewId });
    return NextResponse.json({ ...preview, aiCalled: false, reproducibility: explanation.reproducibility });
  } catch (error) { return recommendationExplanationApiError(error); }
}
