import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import {
  approvalRequirement,
  calculateEffectiveInfluence,
  detectPreferenceConflicts,
  resolveFamilyFriendlyRule,
  selectFairHouseholdTracks,
  type HouseholdCandidate,
  type PreferenceProfile,
} from "./core";
import {
  approvalSchema,
  createHouseholdSchema,
  guestInputSchema,
  guestUpdateSchema,
  householdPlaylistDraftSchema,
  householdPreferenceSchema,
  memberInputSchema,
  memberUpdateSchema,
  updateHouseholdSchema,
  voteSchema,
} from "./schemas";

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : value as Prisma.InputJsonValue;
}

function activeExclusion(excluded: boolean, expiresAt: Date | null, now = new Date()) {
  return excluded && (!expiresAt || expiresAt.getTime() > now.getTime());
}

async function householdAccess(userId: string, householdId: string) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: { members: { where: { userId, isActive: true }, take: 1 } },
  });
  if (!household || (household.ownerId !== userId && !household.members.length)) throw new Error("Household not found");
  return { household, isAdministrator: household.ownerId === userId || household.members.some((member) => member.memberType === "OWNER") };
}

async function requireHouseholdAdministrator(userId: string, householdId: string) {
  const access = await householdAccess(userId, householdId);
  if (!access.isAdministrator) throw new Error("HOUSEHOLD_ADMIN_REQUIRED");
  return access.household;
}

async function activity(input: {
  householdId: string;
  actorUserId?: string | null;
  generatedPlaylistId?: string | null;
  playlistVersion?: number | null;
  eventType: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.householdActivity.create({ data: {
    householdId: input.householdId,
    actorUserId: input.actorUserId || null,
    generatedPlaylistId: input.generatedPlaylistId || null,
    playlistVersion: input.playlistVersion || null,
    eventType: input.eventType,
    summary: input.summary,
    beforeJson: json(input.before),
    afterJson: json(input.after),
    metadataJson: json(input.metadata),
  } });
}

export async function listHouseholds(userId: string, includeArchived = false) {
  await expireHouseholdGuests();
  return prisma.household.findMany({
    where: {
      ...(includeArchived ? {} : { status: "ACTIVE" }),
      OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
    },
    include: {
      _count: { select: { members: { where: { isActive: true } }, guests: { where: { isActive: true } }, playlistConfigurations: true } },
      members: { where: { userId }, select: { memberType: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getHousehold(userId: string, householdId: string) {
  await householdAccess(userId, householdId);
  await expireHouseholdGuests(householdId);
  return prisma.household.findUnique({
    where: { id: householdId },
    include: {
      members: { include: { user: { select: { id: true, username: true, email: true, thumb: true } } }, orderBy: [{ memberType: "asc" }, { displayName: "asc" }] },
      guests: { orderBy: [{ isActive: "desc" }, { displayName: "asc" }] },
      preferences: { orderBy: { updatedAt: "desc" }, take: 200 },
      playlistConfigurations: { include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, trackCount: true, updatedAt: true } }, participants: true }, orderBy: { updatedAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });
}

export async function createHousehold(userId: string, raw: unknown) {
  const input = createHouseholdSchema.parse(raw);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (!user) throw new Error("Unauthorized");
  return prisma.$transaction(async (tx) => {
    const household = await tx.household.create({ data: { ownerId: userId, ...input } });
    await tx.householdMember.create({ data: { householdId: household.id, userId, displayName: user.username, memberType: "OWNER", influenceWeight: 1 } });
    await activity({ householdId: household.id, actorUserId: userId, eventType: "HOUSEHOLD_CREATED", summary: `Created household “${household.name}”.`, after: input }, tx);
    return household;
  });
}

export async function updateHousehold(userId: string, householdId: string, raw: unknown) {
  await requireHouseholdAdministrator(userId, householdId);
  const input = updateHouseholdSchema.parse(raw);
  const before = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const statusData = input.status === "ARCHIVED" ? { archivedAt: new Date() } : input.status === "ACTIVE" ? { archivedAt: null } : {};
  return prisma.$transaction(async (tx) => {
    const updated = await tx.household.update({ where: { id: householdId }, data: { ...input, ...statusData } });
    await activity({ householdId, actorUserId: userId, eventType: input.status === "ARCHIVED" ? "HOUSEHOLD_ARCHIVED" : "HOUSEHOLD_SETTINGS_CHANGED", summary: input.status === "ARCHIVED" ? `Archived household “${before.name}” without deleting its history.` : `Updated household “${updated.name}”.`, before, after: updated }, tx);
    return updated;
  });
}

export async function addHouseholdMember(userId: string, householdId: string, raw: unknown) {
  await requireHouseholdAdministrator(userId, householdId);
  const input = memberInputSchema.parse(raw);
  const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, username: true } });
  if (!target) throw new Error("User not found");
  const existing = await prisma.householdMember.findUnique({ where: { householdId_userId: { householdId, userId: input.userId } } });
  if (existing?.isActive) throw new Error("This user is already a household member");
  return prisma.$transaction(async (tx) => {
    const member = existing
      ? await tx.householdMember.update({ where: { id: existing.id }, data: { ...input, displayName: input.displayName || target.username, isActive: true } })
      : await tx.householdMember.create({ data: { householdId, ...input, displayName: input.displayName || target.username } });
    await activity({ householdId, actorUserId: userId, eventType: "MEMBER_ADDED", summary: `Added ${member.displayName} to the household.`, after: member }, tx);
    return member;
  });
}

export async function updateHouseholdMember(userId: string, householdId: string, memberId: string, raw: unknown) {
  const household = await requireHouseholdAdministrator(userId, householdId);
  const input = memberUpdateSchema.parse(raw);
  const before = await prisma.householdMember.findFirst({ where: { id: memberId, householdId } });
  if (!before) throw new Error("Household member not found");
  if (before.userId === household.ownerId && (input.isActive === false || input.memberType && input.memberType !== "OWNER")) throw new Error("The household owner cannot be removed or demoted");
  return prisma.$transaction(async (tx) => {
    const member = await tx.householdMember.update({ where: { id: memberId }, data: input });
    const exclusionChanged = before.temporarilyExcluded !== member.temporarilyExcluded || before.exclusionExpiresAt?.getTime() !== member.exclusionExpiresAt?.getTime();
    await activity({ householdId, actorUserId: userId, eventType: exclusionChanged ? (member.temporarilyExcluded ? "MEMBER_EXCLUDED" : "MEMBER_RESTORED") : before.influenceWeight !== member.influenceWeight ? "MEMBER_INFLUENCE_CHANGED" : member.isActive ? "MEMBER_SETTINGS_CHANGED" : "MEMBER_REMOVED", summary: member.temporarilyExcluded ? `${member.displayName} was temporarily excluded.` : !member.isActive ? `${member.displayName} was removed from active membership; history was retained.` : `Updated ${member.displayName}'s household settings.`, before, after: member }, tx);
    return member;
  });
}

export async function removeHouseholdMember(userId: string, householdId: string, memberId: string) {
  return updateHouseholdMember(userId, householdId, memberId, { isActive: false, temporarilyExcluded: false, exclusionExpiresAt: null });
}

export async function createHouseholdGuest(userId: string, householdId: string, raw: unknown) {
  await requireHouseholdAdministrator(userId, householdId);
  const input = guestInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const guest = await tx.householdGuest.create({ data: { householdId, ...input, preferencesJson: json(input.preferences), preferences: undefined } });
    await activity({ householdId, actorUserId: userId, eventType: "GUEST_ADDED", summary: `Added guest profile ${guest.displayName}.`, after: guest }, tx);
    return guest;
  });
}

export async function updateHouseholdGuest(userId: string, householdId: string, guestId: string, raw: unknown) {
  await requireHouseholdAdministrator(userId, householdId);
  const input = guestUpdateSchema.parse(raw);
  const before = await prisma.householdGuest.findFirst({ where: { id: guestId, householdId } });
  if (!before) throw new Error("Guest profile not found");
  const { preferences, ...fields } = input;
  return prisma.$transaction(async (tx) => {
    const guest = await tx.householdGuest.update({ where: { id: guestId }, data: { ...fields, ...(preferences ? { preferencesJson: json(preferences) } : {}) } });
    await activity({ householdId, actorUserId: userId, eventType: guest.isActive ? "GUEST_CHANGED" : "GUEST_REMOVED", summary: `Updated guest profile ${guest.displayName}.`, before, after: guest }, tx);
    return guest;
  });
}

export async function resetHouseholdGuestFeedback(userId: string, householdId: string, guestId: string) {
  await requireHouseholdAdministrator(userId, householdId);
  const guest = await prisma.householdGuest.findFirst({ where: { id: guestId, householdId } });
  if (!guest) throw new Error("Guest profile not found");
  return prisma.$transaction(async (tx) => {
    await tx.householdPreference.deleteMany({ where: { householdId, actorGuestId: guestId } });
    const updated = await tx.householdGuest.update({ where: { id: guestId }, data: { preferencesJson: {} } });
    await activity({ householdId, actorUserId: userId, eventType: "GUEST_FEEDBACK_RESET", summary: `Reset temporary feedback for ${guest.displayName}.` }, tx);
    return updated;
  });
}

export async function expireHouseholdGuests(householdId?: string) {
  const now = new Date();
  const expired = await prisma.householdGuest.findMany({ where: { ...(householdId ? { householdId } : {}), isActive: true, expiresAt: { lte: now } }, select: { id: true, householdId: true, displayName: true } });
  if (!expired.length) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.householdGuest.updateMany({ where: { id: { in: expired.map((guest) => guest.id) } }, data: { isActive: false } });
    await tx.householdActivity.createMany({ data: expired.map((guest) => ({ householdId: guest.householdId, eventType: "GUEST_EXPIRED", summary: `Guest profile ${guest.displayName} expired automatically.` })) });
  });
  return expired.length;
}

export async function setHouseholdPreference(userId: string, householdId: string, raw: unknown) {
  const access = await householdAccess(userId, householdId);
  const input = householdPreferenceSchema.parse(raw);
  if (input.scope === "GLOBAL" && !access.isAdministrator) throw new Error("HOUSEHOLD_ADMIN_REQUIRED");
  if (input.actorGuestId) {
    if (!access.isAdministrator) throw new Error("Only a household administrator may submit feedback on behalf of a guest.");
    const guest = await prisma.householdGuest.findFirst({ where: { id: input.actorGuestId, householdId, isActive: true } });
    if (!guest) throw new Error("Guest profile not found");
  }
  const key = { householdId, scope: input.scope, playlistId: input.playlistId || null, targetType: input.targetType, targetId: input.targetId, actorUserId: input.actorGuestId ? null : userId, actorGuestId: input.actorGuestId || null };
  const existing = await prisma.householdPreference.findFirst({ where: key });
  return prisma.$transaction(async (tx) => {
    const preference = existing
      ? await tx.householdPreference.update({ where: { id: existing.id }, data: { state: input.state, strength: input.strength, isHardRule: input.isHardRule || input.state === "HARD_DISLIKE", expiresAt: input.expiresAt } })
      : await tx.householdPreference.create({ data: { ...key, state: input.state, strength: input.strength, isHardRule: input.isHardRule || input.state === "HARD_DISLIKE", expiresAt: input.expiresAt } });
    await activity({ householdId, actorUserId: userId, generatedPlaylistId: input.playlistId, eventType: "FEEDBACK_SUBMITTED", summary: `Recorded ${input.state.toLowerCase().replaceAll("_", " ")} feedback for ${input.targetType.toLowerCase()} ${input.targetId}.`, before: existing, after: preference }, tx);
    return preference;
  });
}

async function loadDraftParticipants(userId: string, raw: unknown) {
  const draft = householdPlaylistDraftSchema.parse(raw);
  await householdAccess(userId, draft.householdId);
  await expireHouseholdGuests(draft.householdId);
  const [household, members, guests] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: draft.householdId } }),
    prisma.householdMember.findMany({ where: { householdId: draft.householdId, id: { in: draft.participantMemberIds }, isActive: true }, include: { user: { select: { recommendationProfile: true } } } }),
    prisma.householdGuest.findMany({ where: { householdId: draft.householdId, id: { in: draft.participantGuestIds }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
  ]);
  if (members.length !== new Set(draft.participantMemberIds).size || guests.length !== new Set(draft.participantGuestIds).size) throw new Error("One or more selected participants are inactive, expired, excluded, or do not belong to this household.");
  return { draft, household, members, guests };
}

export async function previewHouseholdInfluence(userId: string, raw: unknown) {
  const { draft, household, members, guests } = await loadDraftParticipants(userId, raw);
  const memberUserIds = members.map((member) => member.userId);
  const [trackPreferences, artistPreferences, sharedPreferences] = await Promise.all([
    prisma.userTrackPreference.findMany({ where: { userId: { in: memberUserIds }, state: { not: "NEUTRAL" } }, select: { userId: true, trackId: true, state: true } }),
    prisma.userArtistPreference.findMany({ where: { userId: { in: memberUserIds }, state: { not: "NEUTRAL" } }, select: { userId: true, artistId: true, state: true } }),
    prisma.householdPreference.findMany({ where: { householdId: household.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
  ]);
  const participants = [
    ...members.map((member) => ({ id: member.id, displayName: member.displayName, configuredWeight: draft.influenceOverrides[member.id] ?? member.influenceWeight, active: member.isActive, excluded: activeExclusion(member.temporarilyExcluded, member.exclusionExpiresAt), exclusionExpiresAt: member.exclusionExpiresAt, hasUsableHistory: Boolean(member.user.recommendationProfile?.interactionCount || trackPreferences.some((row) => row.userId === member.userId) || artistPreferences.some((row) => row.userId === member.userId)), primary: member.id === draft.primaryMemberId })),
    ...guests.map((guest) => ({ id: guest.id, displayName: guest.displayName, configuredWeight: draft.influenceOverrides[guest.id] ?? guest.influenceWeight, active: guest.isActive, excluded: false, hasUsableHistory: Boolean(guest.preferencesJson && Object.keys(guest.preferencesJson as object).length) || sharedPreferences.some((row) => row.actorGuestId === guest.id), primary: false })),
  ];
  const influence = calculateEffectiveInfluence({ participants, mode: draft.partyModeEnabled ? "PARTY_MODE" : draft.balanceMode, maximumIndividualInfluence: draft.maximumIndividualInfluence, sharedFavoritesWeight: draft.sharedFavoritesWeight, sharedFavoritesEnabled: draft.sharedFavoritesEnabled, redistributeUnusedInfluence: draft.redistributeUnusedInfluence, administratorOverride: draft.administratorOverride });
  const profiles: PreferenceProfile[] = [
    ...members.map((member) => {
      const recommendation = member.user.recommendationProfile;
      return { id: member.id, displayName: member.displayName, weight: influence.participants.find((item) => item.id === member.id)?.effectiveInfluence || 0, memberType: member.memberType, discovery: recommendation?.preferredDiscoveryLevel, energy: recommendation?.preferredEnergyMin != null && recommendation.preferredEnergyMax != null ? (recommendation.preferredEnergyMin + recommendation.preferredEnergyMax) / 2 : recommendation?.preferredEnergyMin, bpm: recommendation?.preferredBpmMin != null && recommendation.preferredBpmMax != null ? (recommendation.preferredBpmMin + recommendation.preferredBpmMax) / 2 : recommendation?.preferredBpmMin, popularity: recommendation?.preferredPopularityWeight, explicitRule: member.familyFriendlyRestriction, likedTrackIds: trackPreferences.filter((row) => row.userId === member.userId && row.state === "LIKED").map((row) => row.trackId), dislikedTrackIds: trackPreferences.filter((row) => row.userId === member.userId && ["DISLIKED", "NEVER_RECOMMEND"].includes(row.state)).map((row) => row.trackId), likedArtistIds: artistPreferences.filter((row) => row.userId === member.userId && row.state === "PREFER").map((row) => row.artistId), dislikedArtistIds: artistPreferences.filter((row) => row.userId === member.userId && row.state === "RECOMMEND_LESS").map((row) => row.artistId) };
    }),
    ...guests.map((guest) => { const preferences = guest.preferencesJson as any || {}; return { id: guest.id, displayName: guest.displayName, weight: influence.participants.find((item) => item.id === guest.id)?.effectiveInfluence || 0, memberType: "GUEST", explicitRule: guest.explicitContentRestriction, likedTrackIds: preferences.likedTrackIds || [], dislikedTrackIds: preferences.dislikedTrackIds || [] }; }),
  ];
  const conflicts = detectPreferenceConflicts(profiles.filter((profile) => profile.weight > 0));
  const familyRule = resolveFamilyFriendlyRule({ householdRule: household.defaultFamilyRule, playlistRule: draft.familyRule, unknownRatingRule: draft.unknownRatingRule, preferCleanVersions: draft.preferCleanVersions, participants: profiles, administratorOverride: draft.administratorOverride });
  const eligibleVoters = members.filter((member) => member.approvalEligible && !activeExclusion(member.temporarilyExcluded, member.exclusionExpiresAt)).length + guests.filter((guest) => guest.approvalEligible).length;
  const approvals = approvalRequirement({ mode: draft.approvalMode === "CONFLICT_SEVERITY" && !conflicts.some((conflict) => conflict.severity >= (draft.approvalConflictSeverity || 5)) ? "DISABLED" : draft.approvalMode === "CONFLICT_SEVERITY" ? "MAJORITY" : draft.approvalMode, fixedCount: draft.fixedApprovalCount, eligibleVoters, administratorEligible: members.some((member) => member.memberType === "OWNER" && member.approvalEligible) });
  return { draft, household: { id: household.id, name: household.name }, influence, profiles, conflicts, familyRule, approvals };
}

export async function applyHouseholdGeneration(userId: string, raw: unknown, candidates: any[], limit: number) {
  const preview = await previewHouseholdInfluence(userId, raw);
  const sharedPreferences = await prisma.householdPreference.findMany({ where: { householdId: preview.household.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  const profilesById = new Map(preview.profiles.map((profile) => [profile.id, profile]));
  const mapped: HouseholdCandidate[] = candidates.map((track) => {
    const genres = (track.tags || []).filter((tag: any) => String(tag.type || "").toLowerCase() === "genre").map((tag: any) => tag.name || tag.tag?.name).filter(Boolean);
    const userScores: Record<string, number> = {};
    const supportingParticipantIds: string[] = [];
    const opposingParticipantIds: string[] = [];
    for (const [participantId, profile] of Array.from(profilesById.entries())) {
      let score = 50;
      if (profile.likedTrackIds?.includes(track.id)) { score += 40; supportingParticipantIds.push(participantId); }
      if (profile.dislikedTrackIds?.includes(track.id)) { score -= 45; opposingParticipantIds.push(participantId); }
      if (track.artistId && profile.likedArtistIds?.includes(track.artistId)) { score += 15; supportingParticipantIds.push(participantId); }
      if (track.artistId && profile.dislikedArtistIds?.includes(track.artistId)) { score -= 20; opposingParticipantIds.push(participantId); }
      if (profile.likedGenreIds?.some((genre: string) => genres.includes(genre))) score += 10;
      if (profile.dislikedGenreIds?.some((genre: string) => genres.includes(genre))) score -= 15;
      userScores[participantId] = score;
    }
    const targetMatches = (preference: any) => preference.targetType === "TRACK" && preference.targetId === track.id
      || preference.targetType === "ARTIST" && preference.targetId === track.artistId
      || preference.targetType === "GENRE" && genres.includes(preference.targetId);
    const likes = sharedPreferences.filter((preference) => targetMatches(preference) && ["LIKE", "SHARED_LIKE", "GREAT_SHARED_PICK"].includes(preference.state));
    const dislikes = sharedPreferences.filter((preference) => targetMatches(preference) && ["DISLIKE", "SHARED_DISLIKE", "HARD_DISLIKE", "NOT_FAMILY_FRIENDLY"].includes(preference.state));
    const partyBoost = preview.draft.partyModeEnabled
      ? Number(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy ?? 0) * 10 + Number(track.popularity?.score ?? 0) * 0.1 + Math.min(5, Number(track.viewCount || 0) * 0.1)
      : 0;
    const cleanBoost = preview.familyRule.preferCleanVersions && !track.isExplicit ? 3 : 0;
    return { id: track.id, artistId: track.artistId, genres, baseScore: Number(track.score ?? track.baseScore ?? 0) + partyBoost + cleanBoost, flowScore: Number(track.transitionScore ?? 0), isExplicit: Boolean(track.isExplicit), contentRating: track.contentRating, userScores, supportingParticipantIds: Array.from(new Set(supportingParticipantIds)), opposingParticipantIds: Array.from(new Set(opposingParticipantIds)), sharedFavoriteScore: likes.length * 30 - dislikes.length * 25, hardDisliked: dislikes.some((preference) => preference.isHardRule || preference.state === "HARD_DISLIKE" || preference.state === "NOT_FAMILY_FRIENDLY") };
  });
  const result = selectFairHouseholdTracks({ candidates: mapped, influence: preview.influence, limit, maximumTracksPerMemberPercent: preview.draft.maximumTracksPerMemberPercent, maximumConsecutiveMemberTracks: preview.draft.maximumConsecutiveMemberTracks, requireEveryParticipant: preview.draft.requireEveryParticipant, maximumArtistRepetition: preview.draft.maximumArtistRepetition, maximumGenreConcentration: preview.draft.maximumGenreConcentration, familyRule: preview.familyRule });
  const originalById = new Map(candidates.map((track) => [track.id, track]));
  return { ...preview, ...result, tracks: result.tracks.map((selected) => ({ ...originalById.get(selected.id), householdScore: selected.householdCompatibilityScore, householdContribution: { primaryContributorId: selected.primaryContributorId, selectionReason: selected.selectionReason, supportingParticipantIds: selected.supportingParticipantIds, opposingParticipantIds: selected.opposingParticipantIds } })) };
}

export async function configureHouseholdPlaylist(userId: string, generatedPlaylistId: string, raw: unknown, generationSnapshot?: unknown) {
  const preview = await previewHouseholdInfluence(userId, raw);
  await requireHouseholdAdministrator(userId, preview.household.id);
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId } });
  if (!playlist) throw new Error("Generated playlist not found");
  const existing = await prisma.householdPlaylistConfiguration.findUnique({ where: { generatedPlaylistId }, include: { participants: true } });
  return prisma.$transaction(async (tx) => {
    const data = { householdId: preview.household.id, balanceMode: preview.draft.balanceMode, primaryMemberId: preview.draft.primaryMemberId, sharedFavoritesWeight: preview.influence.sharedPreferenceInfluence, maximumIndividualInfluence: preview.draft.maximumIndividualInfluence, maximumTracksPerMemberPercent: preview.draft.maximumTracksPerMemberPercent, maximumConsecutiveMemberTracks: preview.draft.maximumConsecutiveMemberTracks, requireEveryParticipant: preview.draft.requireEveryParticipant, redistributeUnusedInfluence: preview.draft.redistributeUnusedInfluence, administratorOverride: preview.draft.administratorOverride, familyRule: preview.draft.familyRule, unknownRatingRule: preview.draft.unknownRatingRule, preferCleanVersions: preview.draft.preferCleanVersions, partyModeEnabled: preview.draft.partyModeEnabled, partySettingsJson: json(preview.draft.partySettings), votingEnabled: preview.draft.votingEnabled, liveFeedbackEnabled: preview.draft.liveFeedbackEnabled, approvalMode: preview.draft.approvalMode, fixedApprovalCount: preview.draft.fixedApprovalCount, approvalConflictSeverity: preview.draft.approvalConflictSeverity, publicationStatus: preview.approvals.satisfied ? "PUBLISHED" : "PENDING_APPROVAL", fairnessSettingsJson: json({ maximumArtistRepetition: preview.draft.maximumArtistRepetition, maximumGenreConcentration: preview.draft.maximumGenreConcentration }), generationSnapshotJson: json(generationSnapshot || { influence: preview.influence, familyRule: preview.familyRule, conflicts: preview.conflicts, approvals: preview.approvals }) };
    const configuration = existing ? await tx.householdPlaylistConfiguration.update({ where: { id: existing.id }, data }) : await tx.householdPlaylistConfiguration.create({ data: { generatedPlaylistId, ...data } });
    await tx.playlistParticipant.deleteMany({ where: { configurationId: configuration.id } });
    await tx.playlistParticipant.createMany({ data: preview.influence.participants.map((participant) => ({ configurationId: configuration.id, ...(preview.draft.participantMemberIds.includes(participant.id) ? { householdMemberId: participant.id } : { householdGuestId: participant.id }), configuredInfluence: participant.configuredWeight, effectiveInfluence: participant.effectiveInfluence, capReduction: participant.capReduction, isActive: !participant.exclusionReason, temporarilyExcluded: participant.exclusionReason === "TEMPORARILY_EXCLUDED", exclusionExpiresAt: participant.exclusionExpiresAt ? new Date(participant.exclusionExpiresAt) : null })) });
    const version = playlist.revisionCounter + 1;
    const trackSnapshots = Array.isArray((generationSnapshot as any)?.tracks) ? (generationSnapshot as any).tracks : [];
    if (trackSnapshots.length) {
      await tx.playlistContribution.deleteMany({ where: { generatedPlaylistId, playlistVersion: version } });
      await tx.playlistContribution.createMany({ data: trackSnapshots.map((track: any) => {
        const contributorId = track.contribution?.primaryContributorId || null;
        return { generatedPlaylistId, playlistVersion: version, trackId: track.trackId || null, ...(preview.draft.participantMemberIds.includes(contributorId) ? { householdMemberId: contributorId } : preview.draft.participantGuestIds.includes(contributorId) ? { householdGuestId: contributorId } : {}), contributionType: track.contribution?.selectionReason || "NEUTRAL_COMPATIBILITY", contributionWeight: contributorId ? preview.influence.participants.find((participant) => participant.id === contributorId)?.effectiveInfluence || 0 : preview.influence.sharedPreferenceInfluence, primaryContributor: Boolean(contributorId), compatibilityScore: track.householdScore ?? null, selectionReason: track.contribution?.selectionReason || "Selected by household compatibility and playlist flow.", conflictStatus: track.contribution?.opposingParticipantIds?.length ? "DISPUTED_REDUCED_SCORE" : "NONE", metadataJson: json({ position: track.position, supportingParticipantIds: track.contribution?.supportingParticipantIds || [], opposingParticipantIds: track.contribution?.opposingParticipantIds || [] }) };
      }) });
    }
    if (preview.conflicts.length) await tx.preferenceConflict.createMany({ data: preview.conflicts.map((conflict) => ({ householdId: preview.household.id, generatedPlaylistId, generationId: String(playlist.revisionCounter + 1), category: conflict.category, severity: conflict.severity, participantsJson: conflict.participantIds as Prisma.InputJsonValue, conflictingValuesJson: conflict.values as Prisma.InputJsonValue, resolutionMethod: conflict.resolutionMethod, resolvedValueJson: json(conflict.resolvedValue), affectedSelection: conflict.affectedSelection })) });
    if (preview.conflicts.length) await tx.householdActivity.createMany({ data: preview.conflicts.flatMap((conflict) => [
      { householdId: preview.household.id, generatedPlaylistId, playlistVersion: version, eventType: "PREFERENCE_CONFLICT_DETECTED", summary: `${conflict.category.toLowerCase().replaceAll("_", " ")} preference conflict detected at severity ${conflict.severity}.`, metadataJson: json({ participants: conflict.participantIds, values: conflict.values }) },
      { householdId: preview.household.id, generatedPlaylistId, playlistVersion: version, eventType: "CONFLICT_RESOLUTION_APPLIED", summary: `${conflict.category.toLowerCase().replaceAll("_", " ")} conflict resolved using ${conflict.resolutionMethod.toLowerCase().replaceAll("_", " ")}.`, metadataJson: json({ resolvedValue: conflict.resolvedValue, affectedSelection: conflict.affectedSelection }) },
    ]) });
    if (preview.familyRule.blockExplicit) await activity({ householdId: preview.household.id, generatedPlaylistId, playlistVersion: version, eventType: "FAMILY_FRIENDLY_RULE_APPLIED", summary: preview.familyRule.reason }, tx);
    if (preview.influence.capApplied) await activity({ householdId: preview.household.id, generatedPlaylistId, playlistVersion: version, eventType: "INFLUENCE_CAP_APPLIED", summary: "Participant influence caps were applied and unused influence was redistributed.", metadata: preview.influence.participants.filter((participant) => participant.capReduction > 0).map((participant) => ({ participantId: participant.id, capReduction: participant.capReduction })) }, tx);
    if (preview.draft.administratorOverride) await activity({ householdId: preview.household.id, actorUserId: userId, generatedPlaylistId, playlistVersion: version, eventType: "ADMINISTRATOR_OVERRIDE_USED", summary: "A household administrator override was used for this playlist generation." }, tx);
    await activity({ householdId: preview.household.id, actorUserId: userId, generatedPlaylistId, playlistVersion: playlist.revisionCounter + 1, eventType: existing ? "PLAYLIST_HOUSEHOLD_SETTINGS_CHANGED" : "PLAYLIST_ASSIGNED_TO_HOUSEHOLD", summary: `${playlist.plexPlaylistTitle} now uses ${preview.draft.balanceMode.toLowerCase().replaceAll("_", " ")} collaboration with ${preview.influence.participants.filter((participant) => participant.effectiveInfluence > 0).length} active participants.`, before: existing, after: data }, tx);
    return configuration;
  });
}

export async function getHouseholdPlaylistDetails(userId: string, generatedPlaylistId: string) {
  const configuration = await prisma.householdPlaylistConfiguration.findFirst({
    where: { generatedPlaylistId, generatedPlaylist: { OR: [{ userId }, { householdConfiguration: { household: { members: { some: { userId, isActive: true } } } } }] } },
    include: { household: true, participants: { include: { householdMember: true, householdGuest: true } }, generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, plexPlaylistRatingKey: true, revisionCounter: true, trackCount: true } } },
  });
  if (!configuration) return null;
  const version = configuration.generatedPlaylist.revisionCounter + 1;
  const [votes, approvals, conflicts, contributions, recentActivity] = await Promise.all([
    prisma.playlistVote.findMany({ where: { generatedPlaylistId, playlistVersion: version }, orderBy: { updatedAt: "desc" } }),
    prisma.playlistApproval.findMany({ where: { generatedPlaylistId, playlistVersion: version, status: "APPROVED" }, orderBy: { updatedAt: "desc" } }),
    prisma.preferenceConflict.findMany({ where: { generatedPlaylistId }, orderBy: [{ createdAt: "desc" }, { severity: "desc" }], take: 100 }),
    prisma.playlistContribution.findMany({ where: { generatedPlaylistId, playlistVersion: version }, orderBy: { createdAt: "asc" } }),
    prisma.householdActivity.findMany({ where: { generatedPlaylistId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const eligible = configuration.participants.filter((participant) => participant.isActive && !participant.temporarilyExcluded && !participant.excludeFromApprovals && (participant.householdMember?.approvalEligible || participant.householdGuest?.approvalEligible)).length;
  const effectiveApprovalMode = configuration.approvalMode === "CONFLICT_SEVERITY"
    ? conflicts.some((conflict) => conflict.severity >= (configuration.approvalConflictSeverity || 5)) ? "MAJORITY" : "DISABLED"
    : configuration.approvalMode;
  const requirement = approvalRequirement({ mode: effectiveApprovalMode, fixedCount: configuration.fixedApprovalCount, eligibleVoters: eligible, administratorEligible: configuration.participants.some((participant) => participant.householdMember?.memberType === "OWNER" && participant.householdMember.approvalEligible) });
  const contributionTrackIds = contributions.map((contribution) => contribution.trackId).filter((trackId): trackId is string => Boolean(trackId));
  const contributionTracks = contributionTrackIds.length ? await prisma.track.findMany({ where: { id: { in: contributionTrackIds } }, select: { id: true, title: true, artist: { select: { title: true } } } }) : [];
  const trackById = new Map(contributionTracks.map((track) => [track.id, track]));
  return { configuration, votes, approvals, approvalProgress: { ...requirement, approved: approvals.length, remaining: Math.max(0, requirement.required - approvals.length), satisfied: approvals.length >= requirement.required }, conflicts, contributions: contributions.map((contribution) => ({ ...contribution, track: contribution.trackId ? trackById.get(contribution.trackId) || null : null })), recentActivity };
}

export async function submitPlaylistVote(userId: string, generatedPlaylistId: string, raw: unknown) {
  const input = voteSchema.parse(raw);
  const details = await getHouseholdPlaylistDetails(userId, generatedPlaylistId);
  if (!details?.configuration.votingEnabled) throw new Error("Voting is not enabled for this playlist");
  const member = details.configuration.participants.find((participant) => participant.householdMember?.userId === userId && participant.isActive && !participant.temporarilyExcluded && participant.householdMember.votingEligible);
  const guest = input.guestId ? details.configuration.participants.find((participant) => participant.householdGuestId === input.guestId && participant.householdGuest?.votingEligible && participant.isActive) : null;
  if (!member && !guest) throw new Error("You are not eligible to vote on this playlist");
  if (guest && details.configuration.household.ownerId !== userId) throw new Error("Only the household administrator may submit a guest vote");
  const voterKey = guest ? `guest:${guest.householdGuestId}` : `user:${userId}`;
  const key = { generatedPlaylistId_playlistVersion_targetType_targetId_voterKey: { generatedPlaylistId, playlistVersion: input.playlistVersion, targetType: input.targetType, targetId: input.targetId, voterKey } };
  const previousVote = await prisma.playlistVote.findUnique({ where: key });
  return prisma.$transaction(async (tx) => {
    const vote = await tx.playlistVote.upsert({ where: key, create: { householdId: details.configuration.householdId, generatedPlaylistId, playlistVersion: input.playlistVersion, targetType: input.targetType, targetId: input.targetId, voterKey, userId: guest ? null : userId, householdMemberId: member?.householdMemberId, householdGuestId: guest?.householdGuestId, voteType: input.voteType }, update: { voteType: input.voteType } });
    await activity({ householdId: details.configuration.householdId, actorUserId: userId, generatedPlaylistId, playlistVersion: input.playlistVersion, eventType: previousVote ? "VOTE_CHANGED" : "VOTE_SUBMITTED", summary: `${voterKey.startsWith("guest:") ? guest?.householdGuest?.displayName : member?.householdMember?.displayName} ${previousVote ? `changed their vote from ${previousVote.voteType.toLowerCase()} to` : "voted"} ${input.voteType.toLowerCase()} on ${input.targetType.toLowerCase()} ${input.targetId}.` }, tx);
    return vote;
  });
}

export async function submitPlaylistApproval(userId: string, generatedPlaylistId: string, raw: unknown) {
  const input = approvalSchema.parse(raw);
  const details = await getHouseholdPlaylistDetails(userId, generatedPlaylistId);
  if (!details) throw new Error("Household playlist not found");
  const member = details.configuration.participants.find((participant) => participant.householdMember?.userId === userId && participant.isActive && !participant.temporarilyExcluded && participant.householdMember.approvalEligible);
  const guest = input.guestId ? details.configuration.participants.find((participant) => participant.householdGuestId === input.guestId && participant.householdGuest?.approvalEligible && participant.isActive) : null;
  if (!member && !guest) throw new Error("You are not eligible to approve this playlist");
  if (guest && details.configuration.household.ownerId !== userId) throw new Error("Only the household administrator may submit a guest approval");
  const approverKey = guest ? `guest:${guest.householdGuestId}` : `user:${userId}`;
  return prisma.$transaction(async (tx) => {
    const approval = await tx.playlistApproval.upsert({ where: { generatedPlaylistId_playlistVersion_approverKey: { generatedPlaylistId, playlistVersion: input.playlistVersion, approverKey } }, create: { householdId: details.configuration.householdId, generatedPlaylistId, playlistVersion: input.playlistVersion, approverKey, userId: guest ? null : userId, householdMemberId: member?.householdMemberId, householdGuestId: guest?.householdGuestId, status: input.status }, update: { status: input.status } });
    const approved = await tx.playlistApproval.count({ where: { generatedPlaylistId, playlistVersion: input.playlistVersion, status: "APPROVED" } });
    const satisfied = approved >= details.approvalProgress.required;
    await tx.householdPlaylistConfiguration.update({ where: { id: details.configuration.id }, data: { publicationStatus: satisfied ? "APPROVED" : "PENDING_APPROVAL" } });
    await activity({ householdId: details.configuration.householdId, actorUserId: userId, generatedPlaylistId, playlistVersion: input.playlistVersion, eventType: satisfied ? "APPROVAL_THRESHOLD_REACHED" : "APPROVAL_CHANGED", summary: satisfied ? `Approval threshold reached with ${approved} approval${approved === 1 ? "" : "s"}.` : `${approverKey} ${input.status === "APPROVED" ? "approved" : "revoked approval for"} the playlist; ${Math.max(0, details.approvalProgress.required - approved)} approval${Math.max(0, details.approvalProgress.required - approved) === 1 ? "" : "s"} remain.` }, tx);
    return { approval, approved, required: details.approvalProgress.required, satisfied };
  });
}

export async function publishApprovedHouseholdPlaylist(userId: string, generatedPlaylistId: string) {
  const details = await getHouseholdPlaylistDetails(userId, generatedPlaylistId);
  if (!details) throw new Error("Household playlist not found");
  await requireHouseholdAdministrator(userId, details.configuration.householdId);
  if (!details.approvalProgress.satisfied || !["APPROVED", "PUBLISHED"].includes(details.configuration.publicationStatus)) throw new Error("The approval threshold has not been reached");
  if (details.configuration.generatedPlaylist.plexPlaylistRatingKey) return { alreadyPublished: true, playlistId: details.configuration.generatedPlaylist.plexPlaylistRatingKey };
  const snapshot = await prisma.generatedPlaylist.findUnique({ where: { id: generatedPlaylistId }, include: { tracks: { orderBy: { position: "asc" }, select: { trackId: true } } } });
  if (!snapshot) throw new Error("Generated playlist not found");
  const trackIds = snapshot.tracks.map((track) => track.trackId).filter((trackId): trackId is string => Boolean(trackId));
  if (!trackIds.length) throw new Error("The approved draft has no tracks to publish");
  const { exportTracksToPlex } = await import("../playlistService");
  const result = await exportTracksToPlex({ userId, name: snapshot.plexPlaylistTitle, trackIds });
  await prisma.$transaction(async (tx) => {
    await tx.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { serverId: result.serverId, plexPlaylistRatingKey: result.playlistId || null } });
    await tx.householdPlaylistConfiguration.update({ where: { id: details.configuration.id }, data: { publicationStatus: "PUBLISHED" } });
    await activity({ householdId: details.configuration.householdId, actorUserId: userId, generatedPlaylistId, playlistVersion: snapshot.revisionCounter + 1, eventType: "PLAYLIST_PUBLISHED", summary: `Published approved household playlist “${snapshot.plexPlaylistTitle}” to Plex with ${result.trackCount} tracks.` }, tx);
  });
  return { ...result, alreadyPublished: false };
}

export async function updatePlaylistParticipantExclusion(userId: string, generatedPlaylistId: string, participantId: string, raw: unknown) {
  const input = memberUpdateSchema.pick({ temporarilyExcluded: true, exclusionExpiresAt: true }).extend({ excludeFromApprovals: memberUpdateSchema.shape.approvalEligible.transform((value) => !value).optional() }).parse(raw);
  const configuration = await prisma.householdPlaylistConfiguration.findUnique({ where: { generatedPlaylistId }, include: { household: true, participants: { include: { householdMember: true, householdGuest: true } }, generatedPlaylist: { select: { plexPlaylistTitle: true, revisionCounter: true } } } });
  if (!configuration) throw new Error("Household playlist not found");
  await requireHouseholdAdministrator(userId, configuration.householdId);
  const target = configuration.participants.find((participant) => participant.id === participantId);
  if (!target) throw new Error("Playlist participant not found");
  const now = new Date();
  const nextParticipants = configuration.participants.map((participant) => ({ id: participant.id, displayName: participant.householdMember?.displayName || participant.householdGuest?.displayName || "Participant", configuredWeight: participant.configuredInfluence, active: participant.isActive, excluded: participant.id === participantId ? input.temporarilyExcluded : participant.temporarilyExcluded, exclusionExpiresAt: participant.id === participantId ? input.exclusionExpiresAt : participant.exclusionExpiresAt, hasUsableHistory: true, primary: participant.householdMemberId === configuration.primaryMemberId }));
  const influence = calculateEffectiveInfluence({ participants: nextParticipants, mode: configuration.balanceMode as any, maximumIndividualInfluence: configuration.maximumIndividualInfluence, sharedFavoritesWeight: configuration.sharedFavoritesWeight, redistributeUnusedInfluence: configuration.redistributeUnusedInfluence, administratorOverride: configuration.administratorOverride, now });
  await prisma.$transaction(async (tx) => {
    for (const participant of influence.participants) await tx.playlistParticipant.update({ where: { id: participant.id }, data: { temporarilyExcluded: participant.id === participantId ? Boolean(input.temporarilyExcluded) : undefined, exclusionExpiresAt: participant.id === participantId ? input.exclusionExpiresAt || null : undefined, excludeFromApprovals: participant.id === participantId ? input.excludeFromApprovals : undefined, effectiveInfluence: participant.effectiveInfluence, capReduction: participant.capReduction } });
    await activity({ householdId: configuration.householdId, actorUserId: userId, generatedPlaylistId, playlistVersion: configuration.generatedPlaylist.revisionCounter + 1, eventType: input.temporarilyExcluded ? "PLAYLIST_PARTICIPANT_EXCLUDED" : "PLAYLIST_PARTICIPANT_RESTORED", summary: `${target.householdMember?.displayName || target.householdGuest?.displayName} was ${input.temporarilyExcluded ? "temporarily excluded from" : "restored to"} “${configuration.generatedPlaylist.plexPlaylistTitle}”. Preferences were retained.`, before: target, after: { temporarilyExcluded: input.temporarilyExcluded, exclusionExpiresAt: input.exclusionExpiresAt, effectiveInfluence: influence.participants.find((participant) => participant.id === participantId)?.effectiveInfluence } }, tx);
  });
  return getHouseholdPlaylistDetails(userId, generatedPlaylistId);
}

export async function getHouseholdActivity(userId: string, householdId: string, input: { page?: number; pageSize?: number; eventType?: string; actorUserId?: string; generatedPlaylistId?: string; from?: Date; to?: Date }) {
  await householdAccess(userId, householdId);
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize || 25));
  const where = { householdId, ...(input.eventType ? { eventType: input.eventType } : {}), ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), ...(input.generatedPlaylistId ? { generatedPlaylistId: input.generatedPlaylistId } : {}), ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}) };
  const [items, total] = await Promise.all([prisma.householdActivity.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.householdActivity.count({ where })]);
  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}
