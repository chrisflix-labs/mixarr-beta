import { NextResponse } from "next/server";
import { recalculateExperimentMetrics } from "@/lib/experiments/metrics";
import { getExperiment } from "@/lib/experiments/service";
import { experimentApiError, experimentUnauthorized, experimentUserId } from "@/lib/experiments/api";
import { safeFinishJobHistory, safeStartJobHistory } from "@/lib/jobHistory";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const userId = experimentUserId(); if (!userId) return experimentUnauthorized();
  try { const experiment = await getExperiment(userId, params.id); return NextResponse.json({ variants: experiment.variants.map((variant) => ({ variant: variant.variant, metrics: variant.metrics })), recommendation: experiment.recommendationExplanation }); }
  catch (error) { return experimentApiError(error); }
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const userId = experimentUserId(); if (!userId) return experimentUnauthorized();
  const job = await safeStartJobHistory({ userId, type: "smart_experiment", name: "Recalculate Smart Experiment metrics", trigger: "manual", metadata: { experimentId: params.id } });
  try {
    const result = await recalculateExperimentMetrics(userId, params.id);
    await safeFinishJobHistory({ job, status: "success", summary: "Experiment feedback, playback, generation metrics, and suggested winner were recalculated.", counts: { attempted: 2, processed: 2, skipped: 0, failed: 0 }, metadata: { experimentId: params.id, recommendation: result.recommendation as any } });
    return NextResponse.json(result);
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", summary: "Smart Experiment metric recalculation failed.", error, metadata: { experimentId: params.id } });
    return experimentApiError(error);
  }
}
