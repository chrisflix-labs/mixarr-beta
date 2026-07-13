import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getBetaStatus } from "@/lib/featureFlagService";
import { listAvailableScoringModels } from "@/lib/scoringModels";
import { getSupportLinks } from "@/lib/support";
import { validHttpUrl } from "@/lib/appInfo";
import { APP_VERSION } from "@/lib/appVersion";
import prisma from "@/lib/prisma";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const [status, scoringModels, sponsorsState] = await Promise.all([getBetaStatus({ userId }), listAvailableScoringModels(userId), prisma.systemState.findUnique({ where: { key: "betaSponsorsCardHidden" }, select: { value: true } }).catch(() => null)]);
  const sponsorsUrl = validHttpUrl(process.env.GITHUB_SPONSORS_URL);
  const visibleFeatures = status.features.filter((state) => state.available || (status.isAdmin && state.reason === "emergency_disabled"));
  return NextResponse.json({
    ...status,
    applicationVersion: APP_VERSION,
    features: visibleFeatures,
    scoringModels: scoringModels.filter((model) => model.stability === "STABLE" || model.available),
    support: {
      ...getSupportLinks(),
      feedbackUrl: validHttpUrl(process.env.BETA_FEEDBACK_URL),
      githubIssuesUrl: validHttpUrl(process.env.GITHUB_ISSUES_URL),
    },
    sponsors: sponsorsUrl && sponsorsState?.value !== "true" ? { url: sponsorsUrl, text: process.env.GITHUB_SPONSORS_BETA_TEXT || "GitHub Sponsors may receive invitations to private beta features and early Smart Mix experiments. Sponsorship does not guarantee that every experiment will remain available or become stable." } : null,
  });
}
