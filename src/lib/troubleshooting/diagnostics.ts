import type { CandidateFunnel, DiagnosticBundle, DiagnosticFinding } from "./contracts";

const stageLabels: Record<string, string> = {
  missing_metadata: "Missing required metadata", library: "Library restrictions", genre: "Genre requirements",
  mood: "Mood requirements", release_year: "Release-year requirements", bpm: "BPM requirements",
  energy: "Energy requirements", duration: "Duration requirements", rating: "Rating requirements",
  explicit: "Explicit-content rules", recent_play: "Recent-play rules", artist_spacing: "Artist-spacing rules",
  track_spacing: "Track-spacing rules", playlist_history: "Playlist-history rules", phase: "Phase rules",
  protected_playlist: "Protected-playlist rules", conflicts: "Conflicting requirements", duplicates: "Duplicates",
};

export function buildCandidateFunnel(input: { totalScanned: number; requested: number; selected?: number; firstRejectionCounts: Record<string, number>; overlapCounts?: Record<string, number> }): CandidateFunnel {
  const total = Math.max(0, Math.trunc(input.totalScanned));
  const requested = Math.max(0, Math.trunc(input.requested));
  let remaining = total;
  const stages = Object.entries(input.firstRejectionCounts).map(([id, raw]) => {
    const rejected = Math.min(remaining, Math.max(0, Math.trunc(raw)));
    remaining -= rejected;
    return { id, label: stageLabels[id] || id.replace(/_/g, " "), rejected, remaining };
  });
  const selected = Math.min(remaining, Math.max(0, Math.trunc(input.selected ?? remaining)));
  return { totalScanned: total, requested, eligible: remaining, selected, unfilled: Math.max(0, requested - selected), stages, overlap: input.overlapCounts };
}

function finding(value: Omit<DiagnosticFinding, "checkVersion">): DiagnosticFinding { return { checkVersion: "1.0", ...value }; }

export function candidateShortageFindings(funnel: CandidateFunnel, resource?: { type: string; id: string; label?: string }): DiagnosticFinding[] {
  if (funnel.selected >= funnel.requested) return [];
  const largest = [...funnel.stages].sort((a, b) => b.rejected - a.rejected)[0];
  const affectedResources = resource ? [resource] : [];
  return [finding({
    checkId: "recipe.candidate_pool.exhausted", category: "PLAYLIST_CANDIDATES", title: "Candidate pool exhausted",
    severity: funnel.selected === 0 ? "ERROR" : "WARNING", evidenceStrength: "CONFIRMED",
    summary: `Only ${funnel.eligible} eligible candidates remained for ${funnel.requested} requested tracks; ${funnel.unfilled} positions could not be filled.`,
    observedValues: { totalScanned: funnel.totalScanned, eligibleCandidates: funnel.eligible, selectedTracks: funnel.selected, unfilledPositions: funnel.unfilled, candidateFunnel: funnel },
    expectedValues: { requestedTracks: funnel.requested },
    evidence: [{ label: "Tracks scanned", value: funnel.totalScanned }, { label: "Eligible candidates", value: funnel.eligible }, { label: "Largest first-rejection constraint", value: largest ? `${largest.label}: ${largest.rejected}` : "Not available" }],
    affectedResources, possibleActions: ["Review the largest deterministic rejection stages.", "Run a non-persistent what-if simulation before changing a recipe."],
    limitations: ["A rejection count does not prove how many tracks a rule change would recover; exact recovery requires a deterministic simulation."],
  })];
}

export function runDeterministicChecks(bundle: DiagnosticBundle): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const jobs = Array.isArray(bundle.recent_jobs) ? bundle.recent_jobs as any[] : [];
  const failed = jobs.filter((job) => String(job.status).toLowerCase() === "failed");
  if (failed.length) findings.push(finding({ checkId: "jobs.recent_failures", category: "JOBS", title: "Recent jobs failed", severity: "ERROR", evidenceStrength: "CONFIRMED", summary: `${failed.length} of the collected recent jobs failed.`, observedValues: { failedJobs: failed.length, collectedJobs: jobs.length }, expectedValues: { failedJobs: 0 }, evidence: failed.slice(0, 10).map((job) => ({ label: String(job.name || job.type || "Job"), value: String(job.error || job.summary || "Failed"), observedAt: job.startedAt })), affectedResources: failed.map((job) => ({ type: "JOB", id: String(job.id) })), possibleActions: ["Open the failed job and review its sanitized error.", "Retry through the existing job workflow after resolving the cause."], limitations: [] }));
  const providers = Array.isArray(bundle.provider_status) ? bundle.provider_status as any[] : [];
  const unhealthy = providers.filter((provider) => provider.healthState && !["HEALTHY", "AVAILABLE", "NOT_TESTED"].includes(String(provider.healthState).toUpperCase()));
  if (unhealthy.length) findings.push(finding({ checkId: "provider.connection.unhealthy", category: "PROVIDERS", title: "Provider connection is unhealthy", severity: "ERROR", evidenceStrength: "STRONG", summary: `${unhealthy.length} configured provider connection${unhealthy.length === 1 ? " is" : "s are"} reporting a problem.`, observedValues: { unhealthyProviders: unhealthy.length }, expectedValues: { healthState: "HEALTHY" }, evidence: unhealthy.map((provider) => ({ label: String(provider.displayName || "Provider"), value: String(provider.errorCategory || provider.healthState) })), affectedResources: unhealthy.map((provider) => ({ type: "AI_PROVIDER", id: String(provider.id), label: provider.displayName })), possibleActions: ["Use the existing provider connection test."], limitations: ["A stored provider health result may be stale."] }));
  const plex = bundle.plex_status as any;
  if (plex && !plex.availability && Number(plex.unavailableServers || 0) > 0) findings.push(finding({ checkId: "plex.server.unavailable", category: "PLEX", title: "Plex server is unavailable", severity: "ERROR", evidenceStrength: "STRONG", summary: `${plex.unavailableServers} Plex server connection${plex.unavailableServers === 1 ? " is" : "s are"} unavailable.`, observedValues: plex, expectedValues: { unavailableServers: 0 }, evidence: [{ label: "Unavailable servers", value: plex.unavailableServers }], affectedResources: [], possibleActions: ["Run the existing Plex connection test and verify server access."], limitations: ["This check uses the latest stored connection state."] }));
  const library = bundle.library_statistics as any;
  if (library && !library.availability && library.totalTracks > 0) {
    for (const [field, label] of [["missingBpm", "BPM"], ["missingGenres", "genres"], ["missingEnergy", "energy"]] as const) {
      const missing = Number(library[field] || 0); const ratio = missing / Number(library.totalTracks);
      if (ratio >= .25) findings.push(finding({ checkId: `library.metadata.missing_${field.replace("missing", "").toLowerCase()}`, category: "LIBRARY_METADATA", title: `Many tracks are missing ${label}`, severity: ratio >= .75 ? "ERROR" : "WARNING", evidenceStrength: "CONFIRMED", summary: `${missing} of ${library.totalTracks} tracks (${Math.round(ratio * 100)}%) are missing ${label}.`, observedValues: { missing, totalTracks: library.totalTracks, percentage: Math.round(ratio * 100) }, expectedValues: { missingPercentageBelow: 25 }, evidence: [{ label: `Tracks missing ${label}`, value: missing }, { label: "Total tracks", value: library.totalTracks }], affectedResources: [], possibleActions: ["Use the existing Data Enrichment workflow to fill metadata gaps."], limitations: [] }));
    }
  }
  const evaluation = bundle.evaluation_context as any;
  if (evaluation?.candidateFunnel) findings.push(...candidateShortageFindings(evaluation.candidateFunnel, evaluation.resource));
  if (!findings.length) findings.push(finding({ checkId: "system.no_measurable_issue", category: "SYSTEM", title: "No measurable issue found in approved data", severity: "INFORMATION", evidenceStrength: "MODERATE", summary: "The deterministic checks did not find a measurable failure in the diagnostic categories you approved.", observedValues: { approvedCategories: bundle.selected_privacy_categories }, expectedValues: {}, evidence: [], affectedResources: [], possibleActions: ["Approve an additional relevant diagnostic category or narrow the problem description."], limitations: ["Unapproved, unavailable, and stale data cannot be evaluated."] }));
  return findings;
}

export function requiredElevenOfFiftyFixture() {
  return buildCandidateFunnel({ totalScanned: 2840, requested: 50, selected: 11, firstRejectionCounts: { genre: 2102, release_year: 491, recent_play: 183, artist_spacing: 53 } });
}
