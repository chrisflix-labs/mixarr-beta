export const HOUSEHOLD_BALANCE_MODES = [
  "INDIVIDUAL_FIRST",
  "BALANCED_HOUSEHOLD",
  "WEIGHTED_HOUSEHOLD",
  "SHARED_FAVORITES",
  "DISCOVERY_CONSENSUS",
  "PARTY_MODE",
] as const;

export type HouseholdBalanceMode = typeof HOUSEHOLD_BALANCE_MODES[number];

export type InfluenceParticipant = {
  id: string;
  displayName: string;
  configuredWeight: number;
  active?: boolean;
  excluded?: boolean;
  exclusionExpiresAt?: Date | string | null;
  hasUsableHistory?: boolean;
  primary?: boolean;
};

export type EffectiveInfluence = InfluenceParticipant & {
  configuredNormalized: number;
  effectiveInfluence: number;
  capReduction: number;
  exclusionReason: string | null;
};

export type InfluenceResult = {
  participants: EffectiveInfluence[];
  sharedPreferenceInfluence: number;
  configuredTotal: number;
  normalizationApplied: boolean;
  capApplied: boolean;
  unusedInfluence: number;
  warnings: string[];
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function isCurrentlyExcluded(participant: InfluenceParticipant, now: Date) {
  if (!participant.excluded) return false;
  if (!participant.exclusionExpiresAt) return true;
  return new Date(participant.exclusionExpiresAt).getTime() > now.getTime();
}

function distributeWithCap(weights: Array<{ id: string; weight: number }>, available: number, cap: number) {
  const result = new Map<string, number>(weights.map((item) => [item.id, 0]));
  let remaining = available;
  let eligible = weights.filter((item) => item.weight > 0);
  for (let pass = 0; pass < weights.length + 2 && remaining > 0.0000001 && eligible.length; pass += 1) {
    const denominator = eligible.reduce((sum, item) => sum + item.weight, 0);
    if (denominator <= 0) break;
    let distributed = 0;
    const next: typeof eligible = [];
    for (const item of eligible) {
      const current = result.get(item.id) || 0;
      const proposed = remaining * (item.weight / denominator);
      const addition = Math.min(proposed, Math.max(0, cap - current));
      result.set(item.id, current + addition);
      distributed += addition;
      if (current + addition < cap - 0.0000001) next.push(item);
    }
    remaining = Math.max(0, remaining - distributed);
    if (distributed <= 0.0000001) break;
    eligible = next;
  }
  return { result, unused: remaining };
}

export function calculateEffectiveInfluence(input: {
  participants: InfluenceParticipant[];
  mode: HouseholdBalanceMode;
  maximumIndividualInfluence?: number | null;
  sharedFavoritesWeight?: number | null;
  sharedFavoritesEnabled?: boolean;
  redistributeUnusedInfluence?: boolean;
  administratorOverride?: boolean;
  now?: Date;
}): InfluenceResult {
  const now = input.now || new Date();
  const configuredTotal = input.participants.reduce((sum, participant) => sum + Math.max(0, participant.configuredWeight || 0), 0);
  const sharedPreferenceInfluence = input.sharedFavoritesEnabled === false
    ? 0
    : clamp(input.sharedFavoritesWeight ?? (input.mode === "SHARED_FAVORITES" ? 0.3 : 0.15), 0, 0.9);
  const memberPool = 1 - sharedPreferenceInfluence;
  const defaultCap = input.mode === "INDIVIDUAL_FIRST" ? 1 : input.mode === "BALANCED_HOUSEHOLD" ? 0.5 : 1;
  const cap = input.administratorOverride ? 1 : clamp(input.maximumIndividualInfluence ?? defaultCap, 0.05, 1);
  const active = input.participants.filter((participant) => participant.active !== false && !isCurrentlyExcluded(participant, now));
  const usable = active.filter((participant) => participant.hasUsableHistory !== false);
  const source = usable.length ? usable : active;
  const weighted = source.map((participant) => {
    let weight = Math.max(0, participant.configuredWeight || 0);
    if (input.mode === "BALANCED_HOUSEHOLD" || input.mode === "DISCOVERY_CONSENSUS" || input.mode === "PARTY_MODE") weight = 1;
    if (input.mode === "INDIVIDUAL_FIRST" && participant.primary) weight = Math.max(weight, 1) * 2;
    return { id: participant.id, weight };
  });
  if (weighted.length && weighted.every((item) => item.weight === 0)) weighted.forEach((item) => { item.weight = 1; });
  const denominator = weighted.reduce((sum, item) => sum + item.weight, 0);
  const configuredNormalized = new Map(weighted.map((item) => [item.id, denominator ? memberPool * item.weight / denominator : 0]));
  const capped = distributeWithCap(weighted, memberPool, cap);
  const shouldRedistribute = input.redistributeUnusedInfluence !== false;
  const unusedInfluence = shouldRedistribute ? capped.unused : Math.max(capped.unused, memberPool - Array.from(capped.result.values()).reduce((a, b) => a + b, 0));
  const participants = input.participants.map<EffectiveInfluence>((participant) => {
    const excluded = isCurrentlyExcluded(participant, now);
    const inactive = participant.active === false;
    const noHistory = participant.hasUsableHistory === false && usable.length > 0;
    const normalized = configuredNormalized.get(participant.id) || 0;
    const effective = capped.result.get(participant.id) || 0;
    return {
      ...participant,
      configuredNormalized: normalized,
      effectiveInfluence: effective,
      capReduction: Math.max(0, normalized - effective),
      exclusionReason: inactive ? "INACTIVE" : excluded ? "TEMPORARILY_EXCLUDED" : noHistory ? "NO_USABLE_HISTORY" : null,
    };
  });
  const capApplied = participants.some((participant) => participant.capReduction > 0.000001);
  const warnings = [
    ...(Math.abs(configuredTotal - 1) > 0.000001 && configuredTotal > 0 ? [`Configured member weights totaled ${(configuredTotal * 100).toFixed(1)}% and were normalized without changing the saved values.`] : []),
    ...participants.filter((participant) => participant.exclusionReason === "TEMPORARILY_EXCLUDED").map((participant) => `${participant.displayName} is temporarily excluded and has 0% effective influence.`),
    ...participants.filter((participant) => participant.exclusionReason === "NO_USABLE_HISTORY").map((participant) => `${participant.displayName} has no usable preference history; their unused influence was redistributed.`),
    ...(capApplied ? ["One or more participant influence caps were applied and the remaining influence was redistributed."] : []),
    ...(unusedInfluence > 0.000001 ? [`${(unusedInfluence * 100).toFixed(1)}% influence could not be allocated under the configured caps.`] : []),
  ];
  return { participants, sharedPreferenceInfluence, configuredTotal, normalizationApplied: Math.abs(configuredTotal - 1) > 0.000001, capApplied, unusedInfluence, warnings };
}

export type PreferenceProfile = {
  id: string;
  displayName: string;
  weight: number;
  memberType?: string;
  discovery?: number | null;
  energy?: number | null;
  bpm?: number | null;
  popularity?: number | null;
  explicitRule?: string | null;
  likedArtistIds?: string[];
  dislikedArtistIds?: string[];
  likedGenreIds?: string[];
  dislikedGenreIds?: string[];
  likedTrackIds?: string[];
  dislikedTrackIds?: string[];
};

export type DetectedConflict = {
  category: string;
  severity: number;
  participantIds: string[];
  values: Record<string, unknown>;
  resolutionMethod: string;
  resolvedValue: unknown;
  affectedSelection: boolean;
};

function numericConflict(profiles: PreferenceProfile[], key: "discovery" | "energy" | "bpm" | "popularity", threshold: number): DetectedConflict | null {
  const values = profiles.filter((profile) => typeof profile[key] === "number") as Array<PreferenceProfile & Record<typeof key, number>>;
  if (values.length < 2) return null;
  const numbers = values.map((profile) => profile[key]);
  const spread = Math.max(...numbers) - Math.min(...numbers);
  if (spread < threshold) return null;
  const totalWeight = values.reduce((sum, profile) => sum + Math.max(0, profile.weight), 0) || values.length;
  const resolved = values.reduce((sum, profile) => sum + profile[key] * (Math.max(0, profile.weight) || 1), 0) / totalWeight;
  return {
    category: key === "bpm" ? "BPM" : key.toUpperCase(),
    severity: Math.min(5, Math.max(1, Math.ceil(spread / threshold))),
    participantIds: values.map((profile) => profile.id),
    values: Object.fromEntries(values.map((profile) => [profile.id, profile[key]])),
    resolutionMethod: "WEIGHTED_AVERAGE",
    resolvedValue: Number(resolved.toFixed(3)),
    affectedSelection: true,
  };
}

export function detectPreferenceConflicts(profiles: PreferenceProfile[]): DetectedConflict[] {
  const conflicts = [
    numericConflict(profiles, "discovery", 0.3),
    numericConflict(profiles, "energy", 0.3),
    numericConflict(profiles, "bpm", 30),
    numericConflict(profiles, "popularity", 0.35),
  ].filter((conflict): conflict is DetectedConflict => Boolean(conflict));
  const explicit = profiles.filter((profile) => profile.explicitRule && profile.explicitRule !== "INHERIT");
  if (explicit.some((profile) => profile.explicitRule === "BLOCK") && explicit.some((profile) => profile.explicitRule === "ALLOW")) {
    conflicts.push({ category: "EXPLICIT_CONTENT", severity: 5, participantIds: explicit.map((profile) => profile.id), values: Object.fromEntries(explicit.map((profile) => [profile.id, profile.explicitRule])), resolutionMethod: "STRICTEST_RULE_WINS", resolvedValue: "BLOCK", affectedSelection: true });
  }
  for (const dimension of ["Artist", "Genre", "Track"] as const) {
    const likes = new Map<string, string[]>();
    const dislikes = new Map<string, string[]>();
    for (const profile of profiles) {
      for (const id of profile[`liked${dimension}Ids` as keyof PreferenceProfile] as string[] || []) likes.set(id, [...(likes.get(id) || []), profile.id]);
      for (const id of profile[`disliked${dimension}Ids` as keyof PreferenceProfile] as string[] || []) dislikes.set(id, [...(dislikes.get(id) || []), profile.id]);
    }
    for (const id of Array.from(likes.keys()).filter((value) => dislikes.has(value)).sort()) {
      conflicts.push({ category: dimension.toUpperCase(), severity: dimension === "Track" ? 4 : 3, participantIds: Array.from(new Set([...(likes.get(id) || []), ...(dislikes.get(id) || [])])), values: { targetId: id, likedBy: likes.get(id), dislikedBy: dislikes.get(id) }, resolutionMethod: dimension === "Track" ? "REDUCE_DISPUTED_TRACK_SCORE" : "WEIGHTED_SCORE_REDUCTION", resolvedValue: "REDUCED_SCORE", affectedSelection: true });
    }
  }
  return conflicts.sort((left, right) => right.severity - left.severity || left.category.localeCompare(right.category));
}

export type FamilyRuleResult = {
  blockExplicit: boolean;
  blockUnknownRatings: boolean;
  preferCleanVersions: boolean;
  reason: string;
};

export function resolveFamilyFriendlyRule(input: {
  householdRule?: string | null;
  playlistRule?: string | null;
  unknownRatingRule?: string | null;
  preferCleanVersions?: boolean;
  participants: Array<{ displayName: string; memberType?: string; explicitRule?: string | null }>;
  administratorOverride?: boolean;
}): FamilyRuleResult {
  const restrictingParticipant = input.participants.find((participant) => participant.memberType === "CHILD" || participant.explicitRule === "BLOCK");
  const configuredBlock = input.playlistRule === "BLOCK" || input.householdRule === "BLOCK";
  const blockExplicit = input.administratorOverride ? input.playlistRule === "BLOCK" : Boolean(restrictingParticipant || configuredBlock);
  return {
    blockExplicit,
    blockUnknownRatings: blockExplicit && input.unknownRatingRule !== "ALLOW",
    preferCleanVersions: input.preferCleanVersions !== false,
    reason: restrictingParticipant
      ? `Explicit content is blocked because ${restrictingParticipant.displayName} requires family-friendly content.`
      : blockExplicit ? "Explicit content is blocked by the household or playlist family-friendly rule." : "Explicit content is allowed by the effective household rule.",
  };
}

export function approvalRequirement(input: {
  mode: string;
  fixedCount?: number | null;
  eligibleVoters: number;
  administratorEligible?: boolean;
}) {
  const eligible = Math.max(0, Math.floor(input.eligibleVoters));
  let required = 0;
  if (input.mode === "FIXED") required = Math.max(1, Math.floor(input.fixedCount || 0));
  if (input.mode === "MAJORITY") required = Math.floor(eligible / 2) + 1;
  if (input.mode === "UNANIMOUS") required = eligible;
  if (input.mode === "ADMINISTRATOR_ONLY") required = 1;
  if (input.mode === "DISABLED") required = 0;
  if (required > eligible) throw new Error(`Approval requirement is impossible: ${required} approvals requested but only ${eligible} participants are eligible.`);
  if (input.mode === "ADMINISTRATOR_ONLY" && input.administratorEligible === false) throw new Error("Administrator approval is required but no participating administrator is eligible.");
  return { required, eligible, remaining: required, satisfied: required === 0 };
}

export type HouseholdCandidate = {
  id: string;
  artistId?: string | null;
  genres?: string[];
  baseScore?: number;
  flowScore?: number;
  isExplicit?: boolean;
  contentRating?: string | null;
  userScores: Record<string, number>;
  supportingParticipantIds?: string[];
  opposingParticipantIds?: string[];
  sharedFavoriteScore?: number;
  hardDisliked?: boolean;
};

export type HouseholdSelectedCandidate = HouseholdCandidate & {
  householdCompatibilityScore: number;
  primaryContributorId: string | null;
  selectionReason: string;
};

export function selectFairHouseholdTracks(input: {
  candidates: HouseholdCandidate[];
  influence: InfluenceResult;
  limit: number;
  maximumTracksPerMemberPercent?: number;
  maximumConsecutiveMemberTracks?: number;
  requireEveryParticipant?: boolean;
  maximumArtistRepetition?: number;
  maximumGenreConcentration?: number;
  familyRule?: FamilyRuleResult;
}): { tracks: HouseholdSelectedCandidate[]; adjustments: string[]; excluded: Array<{ id: string; reason: string }> } {
  const participants = input.influence.participants.filter((participant) => participant.effectiveInfluence > 0);
  const influenceById = new Map(participants.map((participant) => [participant.id, participant.effectiveInfluence]));
  const maximumPerParticipant = Math.max(1, Math.floor(input.limit * clamp(input.maximumTracksPerMemberPercent ?? 0.5, 0.05, 1)));
  const maximumConsecutive = Math.max(1, Math.floor(input.maximumConsecutiveMemberTracks ?? 3));
  const artistMaximum = Math.max(1, Math.floor(input.maximumArtistRepetition ?? 3));
  const genreMaximum = Math.max(1, Math.floor(input.limit * clamp(input.maximumGenreConcentration ?? 0.6, 0.05, 1)));
  const excluded: Array<{ id: string; reason: string }> = [];
  const eligible = input.candidates.filter((candidate) => {
    if (candidate.hardDisliked) { excluded.push({ id: candidate.id, reason: "HARD_HOUSEHOLD_DISLIKE" }); return false; }
    if (input.familyRule?.blockExplicit && candidate.isExplicit) { excluded.push({ id: candidate.id, reason: "FAMILY_FRIENDLY_EXPLICIT" }); return false; }
    if (input.familyRule?.blockUnknownRatings && candidate.contentRating == null) { excluded.push({ id: candidate.id, reason: "FAMILY_FRIENDLY_UNKNOWN_RATING" }); return false; }
    return true;
  }).map<HouseholdSelectedCandidate>((candidate) => {
    const weighted = participants.map((participant) => ({ id: participant.id, value: (candidate.userScores[participant.id] || 0) * participant.effectiveInfluence }));
    const best = weighted.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0];
    const shared = (candidate.sharedFavoriteScore || 0) * input.influence.sharedPreferenceInfluence;
    const preference = weighted.reduce((sum, item) => sum + item.value, 0);
    const conflictPenalty = (candidate.opposingParticipantIds?.length || 0) * 5;
    const consensusBoost = Math.max(0, (candidate.supportingParticipantIds?.length || 0) - 1) * 4;
    const score = (candidate.baseScore || 0) + preference + shared + consensusBoost - conflictPenalty + (candidate.flowScore || 0);
    const sharedWins = shared > (best?.value || 0);
    return { ...candidate, householdCompatibilityScore: Number(score.toFixed(4)), primaryContributorId: sharedWins ? null : best?.id || null, selectionReason: sharedWins ? "SHARED_FAVORITE" : best ? "PARTICIPANT_PREFERENCE" : "NEUTRAL_COMPATIBILITY" };
  }).sort((left, right) => right.householdCompatibilityScore - left.householdCompatibilityScore || left.id.localeCompare(right.id));

  const selected: HouseholdSelectedCandidate[] = [];
  const participantCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const remaining = [...eligible];
  while (selected.length < input.limit && remaining.length) {
    const missing = input.requireEveryParticipant === false ? [] : participants.filter((participant) => !participantCounts.get(participant.id));
    let chosenIndex = remaining.findIndex((candidate) => {
      const contributor = candidate.primaryContributorId;
      if (missing.length && contributor && !missing.some((participant) => participant.id === contributor)) return false;
      if (contributor && (participantCounts.get(contributor) || 0) >= maximumPerParticipant) return false;
      if (contributor && selected.slice(-maximumConsecutive).every((track) => track.primaryContributorId === contributor) && selected.length >= maximumConsecutive) return false;
      if (candidate.artistId && (artistCounts.get(candidate.artistId) || 0) >= artistMaximum) return false;
      if ((candidate.genres || []).some((genre) => (genreCounts.get(genre) || 0) >= genreMaximum)) return false;
      return true;
    });
    if (chosenIndex < 0) break;
    const [chosen] = remaining.splice(chosenIndex, 1);
    selected.push(chosen);
    if (chosen.primaryContributorId) participantCounts.set(chosen.primaryContributorId, (participantCounts.get(chosen.primaryContributorId) || 0) + 1);
    if (chosen.artistId) artistCounts.set(chosen.artistId, (artistCounts.get(chosen.artistId) || 0) + 1);
    for (const genre of chosen.genres || []) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  }
  const adjustments = [
    ...participants.filter((participant) => participant.capReduction > 0).map((participant) => `${participant.displayName}'s influence was reduced by ${(participant.capReduction * 100).toFixed(1)} percentage points by the member cap.`),
    ...(excluded.some((item) => item.reason.startsWith("FAMILY_FRIENDLY")) ? [`${excluded.filter((item) => item.reason.startsWith("FAMILY_FRIENDLY")).length} tracks were excluded by family-friendly rules.`] : []),
    ...(selected.length < Math.min(input.limit, eligible.length) ? ["Fairness limits prevented all requested slots from being filled without violating hard constraints."] : []),
  ];
  return { tracks: selected, adjustments, excluded };
}
