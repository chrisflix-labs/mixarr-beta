import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { queryInBatches } from "../databaseBatching";
import { exportTracksToPlex, syncGeneratedPlaylistToPlex } from "../playlistService";
import { analyzePlaylistHandoff, calculateChainScores, summarizeJourneyPlaylist } from "./analysis";
import { chainInputSchema, chainMemberInputSchema, chainSettingsSchema, handoffInputSchema, type BpmHandoffMode, type EnergyHandoffMode, type MoodHandoffMode, type PlaylistJourneySummary } from "./types";
import { ensureBuiltInPlaylistRoles } from "./roles";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const terminalStatus = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);

const memberSelect = {
  orderBy: { sequencePosition: "asc" as const },
  include: {
    roleDefinition: true,
    playlist: {
      include: {
        tracks: { orderBy: { position: "asc" as const } },
        roleAssignment: { include: { roleDefinition: true } },
        identity: { select: { enabled: true, confidence: true, strength: true, confidenceState: true, effectiveProfileJson: true } },
      },
    },
  },
};

const chainInclude = {
  members: memberSelect,
  handoffs: { include: { transitionTracks: { include: { track: { include: { artist: true, album: true, audioFeature: true, tags: true, popularity: true } } } } } },
  masterGeneratedPlaylist: { select: { id: true, plexPlaylistTitle: true, plexPlaylistRatingKey: true, trackCount: true, updatedAt: true } },
};

async function ownedChain(userId: string, chainId: string) {
  const chain = await prisma.playlistProgressionChain.findFirst({ where: { id: chainId, userId }, include: chainInclude });
  if (!chain) throw new Error("Progression chain not found.");
  return chain;
}

async function validatePlaylists(userId: string, playlistIds: string[]) {
  const unique = Array.from(new Set(playlistIds));
  const playlists = await queryInBatches(unique, (ids) => prisma.generatedPlaylist.findMany({ where: { id: { in: ids }, userId }, select: { id: true, serverId: true } }));
  if (playlists.length !== unique.length) throw new Error("A playlist was not found or is not accessible.");
  return playlists;
}

async function validateRoles(userId: string, roleIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(roleIds.filter((id): id is string => Boolean(id))));
  if (!ids.length) return;
  await ensureBuiltInPlaylistRoles();
  const count = await prisma.playlistRoleDefinition.count({ where: { id: { in: ids }, OR: [{ isBuiltIn: true }, { userId }] } });
  if (count !== ids.length) throw new Error("A playlist role was not found or is not accessible.");
}

function memberData(member: z.infer<typeof chainMemberInputSchema>, chainId: string, position: number) {
  return {
    chainId, playlistId: member.playlistId, sequencePosition: position, roleDefinitionId: member.roleDefinitionId,
    roleOverrideJson: member.roleOverride ? json(member.roleOverride) : undefined,
    expectedStartEnergy: member.expectedStartEnergy, expectedEndEnergy: member.expectedEndEnergy,
    expectedStartBpm: member.expectedStartBpm, expectedEndBpm: member.expectedEndBpm,
    targetMood: member.targetMood, minimumEnergy: member.minimumEnergy, maximumEnergy: member.maximumEnergy,
    minimumBpm: member.minimumBpm, maximumBpm: member.maximumBpm, recommendedDuration: member.recommendedDuration,
    handoffBehavior: member.handoffEnabled ? "SMOOTH" : "NONE", handoffEnabled: member.handoffEnabled,
    autoHandoffGuidance: member.autoHandoffGuidance,
  };
}

async function reconcileHandoffs(chainId: string) {
  const members = await prisma.playlistProgressionMember.findMany({ where: { chainId }, orderBy: { sequencePosition: "asc" }, select: { id: true } });
  const pairs = members.slice(0, -1).map((member, index) => ({ fromMemberId: member.id, toMemberId: members[index + 1].id }));
  const keys = new Set(pairs.map((pair) => `${pair.fromMemberId}:${pair.toMemberId}`));
  const existing = await prisma.playlistChainHandoff.findMany({ where: { chainId }, select: { id: true, fromMemberId: true, toMemberId: true, locked: true } });
  const obsolete = existing.filter((handoff) => !keys.has(`${handoff.fromMemberId}:${handoff.toMemberId}`));
  if (obsolete.length) await prisma.playlistChainHandoff.deleteMany({ where: { id: { in: obsolete.map((handoff) => handoff.id) } } });
  for (const pair of pairs) await prisma.playlistChainHandoff.upsert({ where: { chainId_fromMemberId_toMemberId: { chainId, ...pair } }, create: { chainId, ...pair }, update: {} });
}

function compactChain(chain: any) {
  const totalDuration = chain.members.reduce((sum: number, member: any) => sum + (Array.isArray(member.playlist.tracks) ? member.playlist.tracks.reduce((trackSum: number, track: any) => trackSum + Number((track as any).duration || 0), 0) : 0), 0);
  const analysis = (chain.analysisJson || {}) as Record<string, any>;
  return {
    ...chain,
    playlistCount: chain.members.length,
    totalTrackCount: chain.members.reduce((sum: number, member: any) => sum + member.playlist.trackCount, 0),
    totalEstimatedDurationMs: totalDuration || analysis.totalEstimatedDurationMs || 0,
    warnings: analysis.warnings || [],
  };
}

export async function listPlaylistChains(userId: string, input: { page?: number; pageSize?: number; status?: string; query?: string } = {}) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize || 20));
  const status = input.status && terminalStatus.has(input.status) ? input.status : undefined;
  const where = { userId, ...(status ? { status } : {}), ...(input.query ? { name: { contains: input.query, mode: "insensitive" as const } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.playlistProgressionChain.findMany({ where, include: { members: { orderBy: { sequencePosition: "asc" }, include: { roleDefinition: true, playlist: { select: { id: true, plexPlaylistTitle: true, trackCount: true, lastGeneratedAt: true, updatedAt: true } } } }, handoffs: { select: { qualityScore: true, confidence: true } }, masterGeneratedPlaylist: { select: { id: true, plexPlaylistRatingKey: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.playlistProgressionChain.count({ where }),
  ]);
  return { items: rows.map(compactChain), page, pageSize, total, pages: Math.ceil(total / pageSize) };
}

export async function getPlaylistChain(userId: string, chainId: string) {
  return compactChain(await ownedChain(userId, chainId));
}

export async function createChainVersion(userId: string, chainId: string, reason: string) {
  const chain = await ownedChain(userId, chainId);
  const snapshot = {
    schemaVersion: 1,
    chain: { name: chain.name, description: chain.description, status: chain.status, guidanceEnabled: chain.guidanceEnabled, autoMaintenanceEnabled: chain.autoMaintenanceEnabled, sharedTransitionMode: chain.sharedTransitionMode, masterPlaylistEnabled: chain.masterPlaylistEnabled, settingsJson: chain.settingsJson, maximumAdjacentOverlapPercentage: chain.maximumAdjacentOverlapPercentage, maximumChainOverlapPercentage: chain.maximumChainOverlapPercentage },
    members: chain.members.map((member) => ({ id: member.id, playlistId: member.playlistId, sequencePosition: member.sequencePosition, roleDefinitionId: member.roleDefinitionId, roleOverrideJson: member.roleOverrideJson, expectedStartEnergy: member.expectedStartEnergy, expectedEndEnergy: member.expectedEndEnergy, expectedStartBpm: member.expectedStartBpm, expectedEndBpm: member.expectedEndBpm, targetMood: member.targetMood, minimumEnergy: member.minimumEnergy, maximumEnergy: member.maximumEnergy, minimumBpm: member.minimumBpm, maximumBpm: member.maximumBpm, recommendedDuration: member.recommendedDuration, handoffEnabled: member.handoffEnabled, autoHandoffGuidance: member.autoHandoffGuidance })),
    handoffs: chain.handoffs.map((handoff) => ({ fromMemberId: handoff.fromMemberId, toMemberId: handoff.toMemberId, energyMode: handoff.energyMode, bpmMode: handoff.bpmMode, moodMode: handoff.moodMode, sharedTrackMode: handoff.sharedTrackMode, handoffSettingsJson: handoff.handoffSettingsJson, locked: handoff.locked, transitionTracks: handoff.transitionTracks.map((track) => ({ trackId: track.trackId, placementMode: track.placementMode, score: track.score, locked: track.locked, explanationJson: track.explanationJson })) })),
  };
  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistProgressionChain.update({ where: { id: chainId }, data: { versionCounter: { increment: 1 } }, select: { versionCounter: true } });
    const version = await tx.playlistChainVersion.create({ data: { chainId, versionNumber: updated.versionCounter, reason, snapshotJson: json(snapshot), createdByUserId: userId } });
    const settings = await tx.playlistChainSetting.findUnique({ where: { userId } });
    if (settings?.retainVersions !== false) {
      const retain = Math.max(1, settings?.versionRetentionCount || 20);
      const old = await tx.playlistChainVersion.findMany({ where: { chainId }, orderBy: { versionNumber: "desc" }, skip: retain, select: { id: true } });
      if (old.length) await tx.playlistChainVersion.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    }
    return version;
  });
}

export async function createPlaylistChain(userId: string, raw: unknown) {
  const input = chainInputSchema.parse(raw);
  await Promise.all([validatePlaylists(userId, input.members.map((member) => member.playlistId)), validateRoles(userId, input.members.map((member) => member.roleDefinitionId))]);
  const chain = await prisma.$transaction(async (tx) => {
    const created = await tx.playlistProgressionChain.create({ data: {
      userId, name: input.name, description: input.description, status: input.status, guidanceEnabled: input.guidanceEnabled,
      autoMaintenanceEnabled: input.autoMaintenanceEnabled, sharedTransitionMode: input.sharedTransitionMode,
      masterPlaylistEnabled: input.masterPlaylistEnabled, settingsJson: json(input.settings),
      maximumAdjacentOverlapPercentage: input.maximumAdjacentOverlapPercentage, maximumChainOverlapPercentage: input.maximumChainOverlapPercentage,
    } });
    await tx.playlistProgressionMember.createMany({ data: input.members.map((member, index) => memberData(member, created.id, index + 1)) });
    return created;
  });
  await reconcileHandoffs(chain.id);
  await createChainVersion(userId, chain.id, "chain_created");
  console.info("[PlaylistChains] chain created", { userId, chainId: chain.id, playlistCount: input.members.length });
  return getPlaylistChain(userId, chain.id);
}

const chainPatchSchema = chainInputSchema.omit({ members: true }).partial().extend({ members: z.array(chainMemberInputSchema).min(2).max(50).optional() });

export async function updatePlaylistChain(userId: string, chainId: string, raw: unknown) {
  const input = chainPatchSchema.parse(raw);
  await ownedChain(userId, chainId);
  if (input.members) await Promise.all([validatePlaylists(userId, input.members.map((member) => member.playlistId)), validateRoles(userId, input.members.map((member) => member.roleDefinitionId))]);
  await createChainVersion(userId, chainId, "before_chain_update");
  await prisma.$transaction(async (tx) => {
    await tx.playlistProgressionChain.update({ where: { id: chainId }, data: {
      ...(input.name != null ? { name: input.name } : {}), ...(input.description != null ? { description: input.description } : {}),
      ...(input.status != null ? { status: input.status, archivedAt: input.status === "ARCHIVED" ? new Date() : null } : {}),
      ...(input.guidanceEnabled != null ? { guidanceEnabled: input.guidanceEnabled } : {}),
      ...(input.autoMaintenanceEnabled != null ? { autoMaintenanceEnabled: input.autoMaintenanceEnabled } : {}),
      ...(input.sharedTransitionMode != null ? { sharedTransitionMode: input.sharedTransitionMode } : {}),
      ...(input.masterPlaylistEnabled != null ? { masterPlaylistEnabled: input.masterPlaylistEnabled } : {}),
      ...(input.settings != null ? { settingsJson: json(input.settings) } : {}),
      ...(input.maximumAdjacentOverlapPercentage != null ? { maximumAdjacentOverlapPercentage: input.maximumAdjacentOverlapPercentage } : {}),
      ...(input.maximumChainOverlapPercentage != null ? { maximumChainOverlapPercentage: input.maximumChainOverlapPercentage } : {}),
    } });
    if (input.members) {
      await tx.playlistProgressionMember.deleteMany({ where: { chainId } });
      await tx.playlistProgressionMember.createMany({ data: input.members.map((member, index) => memberData(member, chainId, index + 1)) });
    }
  });
  if (input.members) await reconcileHandoffs(chainId);
  return getPlaylistChain(userId, chainId);
}

export async function duplicatePlaylistChain(userId: string, chainId: string) {
  const source = await ownedChain(userId, chainId);
  let name = `${source.name} Copy`;
  for (let suffix = 2; await prisma.playlistProgressionChain.findFirst({ where: { userId, name }, select: { id: true } }); suffix += 1) name = `${source.name} Copy ${suffix}`;
  return createPlaylistChain(userId, {
    name, description: source.description, status: "DRAFT", guidanceEnabled: source.guidanceEnabled,
    autoMaintenanceEnabled: false, sharedTransitionMode: source.sharedTransitionMode, masterPlaylistEnabled: false,
    maximumAdjacentOverlapPercentage: source.maximumAdjacentOverlapPercentage ?? 15, maximumChainOverlapPercentage: source.maximumChainOverlapPercentage ?? 20,
    settings: source.settingsJson || {}, members: source.members.map((member) => ({ playlistId: member.playlistId, roleDefinitionId: member.roleDefinitionId, roleOverride: member.roleOverrideJson, expectedStartEnergy: member.expectedStartEnergy, expectedEndEnergy: member.expectedEndEnergy, expectedStartBpm: member.expectedStartBpm, expectedEndBpm: member.expectedEndBpm, targetMood: member.targetMood, minimumEnergy: member.minimumEnergy, maximumEnergy: member.maximumEnergy, minimumBpm: member.minimumBpm, maximumBpm: member.maximumBpm, recommendedDuration: member.recommendedDuration, handoffEnabled: member.handoffEnabled, autoHandoffGuidance: member.autoHandoffGuidance })),
  });
}

export async function deletePlaylistChain(userId: string, chainId: string) {
  const result = await prisma.playlistProgressionChain.deleteMany({ where: { id: chainId, userId } });
  if (!result.count) throw new Error("Progression chain not found.");
  console.info("[PlaylistChains] chain deleted", { userId, chainId });
  return { deleted: true, sourcePlaylistsPreserved: true };
}

export async function addChainMember(userId: string, chainId: string, raw: unknown) {
  const input = chainMemberInputSchema.parse(raw);
  const chain = await ownedChain(userId, chainId);
  await Promise.all([validatePlaylists(userId, [input.playlistId]), validateRoles(userId, [input.roleDefinitionId])]);
  await createChainVersion(userId, chainId, "before_member_added");
  await prisma.playlistProgressionMember.create({ data: memberData(input, chainId, chain.members.length + 1) });
  await reconcileHandoffs(chainId);
  return getPlaylistChain(userId, chainId);
}

export async function updateChainMember(userId: string, chainId: string, memberId: string, raw: unknown) {
  const input = chainMemberInputSchema.partial().parse(raw);
  const member = await prisma.playlistProgressionMember.findFirst({ where: { id: memberId, chainId, chain: { userId } } });
  if (!member) throw new Error("Chain member not found.");
  if (input.playlistId) await validatePlaylists(userId, [input.playlistId]);
  if (input.roleDefinitionId) await validateRoles(userId, [input.roleDefinitionId]);
  await createChainVersion(userId, chainId, "before_member_update");
  await prisma.playlistProgressionMember.update({ where: { id: memberId }, data: {
    ...(input.playlistId ? { playlistId: input.playlistId } : {}), ...(input.roleDefinitionId !== undefined ? { roleDefinitionId: input.roleDefinitionId } : {}),
    ...(input.roleOverride !== undefined ? { roleOverrideJson: input.roleOverride ? json(input.roleOverride) : Prisma.JsonNull } : {}),
    ...(input.expectedStartEnergy !== undefined ? { expectedStartEnergy: input.expectedStartEnergy } : {}), ...(input.expectedEndEnergy !== undefined ? { expectedEndEnergy: input.expectedEndEnergy } : {}),
    ...(input.expectedStartBpm !== undefined ? { expectedStartBpm: input.expectedStartBpm } : {}), ...(input.expectedEndBpm !== undefined ? { expectedEndBpm: input.expectedEndBpm } : {}),
    ...(input.targetMood !== undefined ? { targetMood: input.targetMood } : {}), ...(input.minimumEnergy !== undefined ? { minimumEnergy: input.minimumEnergy } : {}),
    ...(input.maximumEnergy !== undefined ? { maximumEnergy: input.maximumEnergy } : {}), ...(input.minimumBpm !== undefined ? { minimumBpm: input.minimumBpm } : {}),
    ...(input.maximumBpm !== undefined ? { maximumBpm: input.maximumBpm } : {}), ...(input.recommendedDuration !== undefined ? { recommendedDuration: input.recommendedDuration } : {}),
    ...(input.handoffEnabled !== undefined ? { handoffEnabled: input.handoffEnabled, handoffBehavior: input.handoffEnabled ? "SMOOTH" : "NONE" } : {}),
    ...(input.autoHandoffGuidance !== undefined ? { autoHandoffGuidance: input.autoHandoffGuidance } : {}),
  } });
  return getPlaylistChain(userId, chainId);
}

export async function removeChainMember(userId: string, chainId: string, memberId: string) {
  const chain = await ownedChain(userId, chainId);
  if (chain.members.length <= 2) throw new Error("A progression chain must contain at least two playlists.");
  const member = chain.members.find((item) => item.id === memberId);
  if (!member) throw new Error("Chain member not found.");
  await createChainVersion(userId, chainId, "before_member_removed");
  await prisma.$transaction(async (tx) => {
    await tx.playlistProgressionMember.delete({ where: { id: memberId } });
    const remaining = await tx.playlistProgressionMember.findMany({ where: { chainId }, orderBy: { sequencePosition: "asc" }, select: { id: true } });
    for (let index = 0; index < remaining.length; index += 1) await tx.playlistProgressionMember.update({ where: { id: remaining[index].id }, data: { sequencePosition: index + 1 } });
  });
  await reconcileHandoffs(chainId);
  return getPlaylistChain(userId, chainId);
}

export async function reorderChainMembers(userId: string, chainId: string, memberIds: string[]) {
  const chain = await ownedChain(userId, chainId);
  const parsed = z.array(z.string().uuid()).min(2).max(50).parse(memberIds);
  if (new Set(parsed).size !== parsed.length || parsed.length !== chain.members.length || chain.members.some((member) => !parsed.includes(member.id))) throw new Error("Reorder must include every chain member exactly once.");
  await createChainVersion(userId, chainId, "before_members_reordered");
  await prisma.$transaction(async (tx) => {
    for (const member of chain.members) await tx.playlistProgressionMember.update({ where: { id: member.id }, data: { sequencePosition: -member.sequencePosition } });
    for (let index = 0; index < parsed.length; index += 1) await tx.playlistProgressionMember.update({ where: { id: parsed[index] }, data: { sequencePosition: index + 1 } });
  });
  await reconcileHandoffs(chainId);
  return getPlaylistChain(userId, chainId);
}

export async function updateChainHandoff(userId: string, chainId: string, handoffId: string, raw: unknown) {
  const input = handoffInputSchema.parse(raw);
  const handoff = await prisma.playlistChainHandoff.findFirst({ where: { id: handoffId, chainId, chain: { userId } } });
  if (!handoff) throw new Error("Chain handoff not found.");
  await createChainVersion(userId, chainId, "before_handoff_update");
  await prisma.playlistChainHandoff.update({ where: { id: handoffId }, data: {
    ...input, ...(input.settings ? { handoffSettingsJson: json(input.settings), settings: undefined } : {}), analysisJson: Prisma.JsonNull, lastAnalyzedAt: null,
  } as any });
  return getPlaylistChain(userId, chainId);
}

async function loadAnalysisContext(userId: string, chainId: string) {
  const chain = await ownedChain(userId, chainId);
  const trackIds = chain.members.flatMap((member) => member.playlist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id)));
  const tracks = await queryInBatches(trackIds, (ids) => prisma.track.findMany({ where: { id: { in: ids }, library: { server: { userId } } }, include: { artist: true, album: true, audioFeature: true, tags: true, popularity: true, metadataCorrections: { where: { isActive: true } } } }));
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const summaries = chain.members.map((member) => summarizeJourneyPlaylist(member.playlist, trackMap));
  return { chain, summaries };
}

export async function analyzePlaylistChain(userId: string, chainId: string, onStage?: (stage: string, processed: number) => Promise<void> | void) {
  await onStage?.("Preparing chain", 0);
  const { chain, summaries } = await loadAnalysisContext(userId, chainId);
  await onStage?.("Calculating playlist summaries", summaries.length);
  const handoffByPair = new Map(chain.handoffs.map((handoff) => [`${handoff.fromMemberId}:${handoff.toMemberId}`, handoff]));
  const handoffs = [];
  for (let index = 0; index < chain.members.length - 1; index += 1) {
    const fromMember = chain.members[index]; const toMember = chain.members[index + 1];
    const stored = handoffByPair.get(`${fromMember.id}:${toMember.id}`);
    const settings = (stored?.handoffSettingsJson || {}) as Record<string, any>;
    const analysis = analyzePlaylistHandoff({
      fromMemberId: fromMember.id, toMemberId: toMember.id, from: summaries[index], to: summaries[index + 1],
      energyMode: (stored?.energyMode || "SMOOTH_CONTINUATION") as EnergyHandoffMode,
      bpmMode: (stored?.bpmMode || "SMOOTH_CONTINUATION") as BpmHandoffMode,
      moodMode: (stored?.moodMode || "SMOOTH_CONTINUATION") as MoodHandoffMode,
      maxPreferredBpmGap: Number(settings.maximumBpmGap) || 8,
    });
    handoffs.push(analysis);
    await onStage?.(index % 3 === 0 ? "Evaluating energy handoffs" : index % 3 === 1 ? "Evaluating BPM handoffs" : "Evaluating mood handoffs", index + 1);
    await prisma.playlistChainHandoff.upsert({
      where: { chainId_fromMemberId_toMemberId: { chainId, fromMemberId: fromMember.id, toMemberId: toMember.id } },
      create: { chainId, fromMemberId: fromMember.id, toMemberId: toMember.id, qualityScore: analysis.qualityScore, energyScore: analysis.energyScore, bpmScore: analysis.bpmScore, moodScore: analysis.moodScore, confidence: analysis.confidence, analysisJson: json(analysis), lastAnalyzedAt: new Date() },
      update: { qualityScore: analysis.qualityScore, energyScore: analysis.energyScore, bpmScore: analysis.bpmScore, moodScore: analysis.moodScore, confidence: analysis.confidence, analysisJson: json(analysis), lastAnalyzedAt: new Date() },
    });
  }
  const roleKeys = chain.members.map((member) => member.roleDefinition?.key || member.playlist.roleAssignment?.roleDefinition.key || null);
  const identityScores = chain.members.map((member) => member.playlist.identity?.enabled ? Math.round(50 + Math.min(1, Math.max(0, member.playlist.identity.confidence)) * 50) : null);
  const scores = calculateChainScores(handoffs, roleKeys, summaries, identityScores);
  const handoffWarnings = handoffs.flatMap((handoff, index) => handoff.warnings.map((warning) => `${chain.members[index].playlist.plexPlaylistTitle} → ${chain.members[index + 1].playlist.plexPlaylistTitle}: ${warning}`));
  const roleWarnings = chain.members.flatMap((member, index) => roleKeys[index] === "archive"
    ? [`${member.playlist.plexPlaylistTitle} uses the Archive role. It remains in the chain for intentional historical playback, but APPLY-mode regeneration is disabled.`]
    : []);
  const warnings = [...handoffWarnings, ...roleWarnings];
  const analysis = { schemaVersion: 1, analyzedAt: new Date().toISOString(), scores: { ...scores, baseOverall: scores.overall, personalizedOverall: scores.overall, personalizationInfluence: 0 }, summaries, handoffs, warnings, totalEstimatedDurationMs: summaries.reduce((sum, summary) => sum + summary.estimatedDurationMs, 0), totalTracks: summaries.reduce((sum, summary) => sum + summary.trackCount, 0) };
  await onStage?.("Finalizing chain score", handoffs.length);
  await prisma.playlistProgressionChain.update({ where: { id: chainId }, data: { analysisJson: json(analysis), qualityScore: scores.overall, lastAnalyzedAt: new Date() } });
  console.info("[PlaylistChains] chain analyzed", { userId, chainId, playlistCount: summaries.length, handoffCount: handoffs.length, score: scores.overall, warningCount: warnings.length });
  return analysis;
}

function boundarySummary(summary: PlaylistJourneySummary, track: any, side: "start" | "end") {
  return side === "end"
    ? { ...summary, endingBpm: track.bpm, endingEnergy: track.energy, endingMoods: track.moods, moodIntensityEnd: track.moodIntensity }
    : { ...summary, startingBpm: track.bpm, startingEnergy: track.energy, startingMoods: track.moods, moodIntensityStart: track.moodIntensity };
}

export async function createChainOptimizationPreview(userId: string, chainId: string) {
  const [{ chain, summaries }, userSettings] = await Promise.all([loadAnalysisContext(userId, chainId), getChainSettings(userId)]);
  const current = chain.analysisJson ? chain.analysisJson as any : await analyzePlaylistChain(userId, chainId);
  const suggestions: any[] = [];
  for (let index = 0; index < chain.members.length - 1; index += 1) {
    const handoff = current.handoffs[index];
    if (!handoff || handoff.qualityScore == null || handoff.qualityScore >= 78) continue;
    const storedHandoff = chain.handoffs.find((item) => item.fromMemberId === chain.members[index].id && item.toMemberId === chain.members[index + 1].id);
    if (storedHandoff?.locked) continue;
    const from = summaries[index]; const to = summaries[index + 1];
    const currentFrom = from.tracks.at(-1); const currentTo = to.tracks[0];
    if (!currentFrom || !currentTo || currentFrom.locked || currentTo.locked) continue;
    let best = { score: handoff.qualityScore, fromTrack: currentFrom, toTrack: currentTo };
    const fromCandidates = from.tracks.slice(-5).filter((track) => !track.locked && track.available);
    const toCandidates = to.tracks.slice(0, 5).filter((track) => !track.locked && track.available);
    for (const fromTrack of fromCandidates) for (const toTrack of toCandidates) {
      const candidate = analyzePlaylistHandoff({ fromMemberId: chain.members[index].id, toMemberId: chain.members[index + 1].id, from: boundarySummary(from, fromTrack, "end"), to: boundarySummary(to, toTrack, "start"), energyMode: handoff.energy.intendedDirection, bpmMode: handoff.bpm.intendedDirection, moodMode: handoff.mood.intendedDirection });
      if ((candidate.qualityScore ?? 0) > best.score) best = { score: candidate.qualityScore!, fromTrack, toTrack };
    }
    const improvement = best.score - handoff.qualityScore;
    if (improvement >= 5 && (best.fromTrack.id !== currentFrom.id || best.toTrack.id !== currentTo.id)) suggestions.push({
      id: `boundary-${chain.members[index].id}-${chain.members[index + 1].id}`, type: "REORDER_BOUNDARY", selectedByDefault: true,
      fromMemberId: chain.members[index].id, toMemberId: chain.members[index + 1].id, fromPlaylistId: from.playlistId, toPlaylistId: to.playlistId,
      currentScore: handoff.qualityScore, projectedScore: best.score, improvement,
      fromTrackId: best.fromTrack.id, toTrackId: best.toTrack.id,
      title: `${from.name} → ${to.name}`, explanation: `Move “${best.fromTrack.title}” to the end and “${best.toTrack.title}” to the opening. The projected handoff improves from ${handoff.qualityScore} to ${best.score}.`,
      preserves: ["Locked tracks", "Liked tracks", "Playlist membership", "Manual metadata"],
    });
    const alreadyInNext = new Set(to.tracks.map((track) => track.id));
    if (userSettings.sharedTransitionTracksEnabled && userSettings.maximumSharedTransitionTracks > 0 && chain.sharedTransitionMode !== "DISABLED" && currentFrom.available && !alreadyInNext.has(currentFrom.id)) suggestions.push({
      id: `shared-${chain.members[index].id}-${chain.members[index + 1].id}-${currentFrom.id}`, type: "ADD_SHARED_TRANSITION", selectedByDefault: false,
      handoffId: storedHandoff?.id,
      fromPlaylistId: from.playlistId, toPlaylistId: to.playlistId, trackId: currentFrom.id,
      currentScore: handoff.qualityScore, projectedScore: Math.max(handoff.qualityScore, Math.round((handoff.qualityScore + 100) / 2)), improvement: Math.max(1, Math.round((100 - handoff.qualityScore) / 2)),
      title: `${from.name} → ${to.name}: shared bridge`, explanation: `Use “${currentFrom.title}” as the ending of ${from.name} and the opening of ${to.name}. It will appear in both Mixarr playlists; Plex is updated only when you explicitly sync or regenerate a master journey.`,
      preserves: ["Locked tracks", "Liked tracks", "Source playlist order", "Manual metadata"],
    });
  }
  const preview = await prisma.playlistChainOptimizationPreview.create({ data: { chainId, userId, baseVersionNumber: chain.versionCounter, suggestionsJson: json(suggestions), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  console.info("[PlaylistChains] optimization preview created", { userId, chainId, suggestionCount: suggestions.length });
  return { id: preview.id, expiresAt: preview.expiresAt, baseVersionNumber: preview.baseVersionNumber, suggestions, noChangesRequired: suggestions.length === 0 };
}

async function moveTrackToBoundary(tx: Prisma.TransactionClient, playlistId: string, trackId: string, side: "start" | "end") {
  const rows = await tx.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: playlistId }, orderBy: { position: "asc" } });
  const index = rows.findIndex((row) => row.trackId === trackId);
  if (index < 0 || rows[index].locked || rows[index].automationProtected) throw new Error("A proposed boundary track is unavailable or locked.");
  const [target] = rows.splice(index, 1);
  side === "start" ? rows.unshift(target) : rows.push(target);
  for (let position = 0; position < rows.length; position += 1) await tx.generatedPlaylistTrack.update({ where: { id: rows[position].id }, data: { position: position + 1 } });
  await tx.generatedPlaylist.update({ where: { id: playlistId }, data: { revisionCounter: { increment: 1 }, updatedAt: new Date() } });
}

async function addSharedTransitionToOpening(tx: Prisma.TransactionClient, userId: string, suggestion: any) {
  const [blocked, excluded] = await Promise.all([
    tx.blockedTrack.findFirst({ where: { userId, trackId: suggestion.trackId }, select: { id: true } }),
    tx.trackExclusion.findFirst({ where: { userId, trackId: suggestion.trackId }, select: { id: true } }),
  ]);
  if (blocked || excluded) throw new Error("The suggested shared transition track is blocked or excluded and cannot be added.");
  const existing = await tx.generatedPlaylistTrack.findFirst({ where: { generatedPlaylistId: suggestion.toPlaylistId, trackId: suggestion.trackId } });
  if (!existing) {
    const [track, source] = await Promise.all([
      tx.track.findFirst({ where: { id: suggestion.trackId, syncStatus: "active", deletedAt: null }, include: { artist: true, album: true } }),
      tx.generatedPlaylistTrack.findFirst({ where: { generatedPlaylistId: suggestion.fromPlaylistId, trackId: suggestion.trackId } }),
    ]);
    if (!track) throw new Error("The suggested shared transition track is no longer available.");
    const rows = await tx.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: suggestion.toPlaylistId }, orderBy: { position: "desc" } });
    for (const row of rows) await tx.generatedPlaylistTrack.update({ where: { id: row.id }, data: { position: row.position + 1 } });
    await tx.generatedPlaylistTrack.create({ data: { generatedPlaylistId: suggestion.toPlaylistId, trackId: track.id, plexTrackRatingKey: track.ratingKey || track.plexId, position: 1, title: track.title, artist: track.artist.title, album: track.album.title, liked: Boolean(source?.liked), locked: Boolean(source?.locked) } });
    await tx.generatedPlaylist.update({ where: { id: suggestion.toPlaylistId }, data: { trackCount: { increment: 1 }, revisionCounter: { increment: 1 }, updatedAt: new Date() } });
  } else if (existing.position !== 1 && !existing.locked && !existing.automationProtected) await moveTrackToBoundary(tx, suggestion.toPlaylistId, suggestion.trackId, "start");
  if (suggestion.handoffId) await tx.playlistChainTransitionTrack.upsert({ where: { handoffId_trackId_placementMode: { handoffId: suggestion.handoffId, trackId: suggestion.trackId, placementMode: "SHARED_BOTH" } }, create: { handoffId: suggestion.handoffId, trackId: suggestion.trackId, placementMode: "SHARED_BOTH", score: suggestion.projectedScore, explanationJson: json({ reason: suggestion.explanation, selectedByUser: true }) }, update: { score: suggestion.projectedScore, explanationJson: json({ reason: suggestion.explanation, selectedByUser: true }) } });
}

export async function applyChainOptimization(userId: string, chainId: string, previewId: string, selectedSuggestionIds: string[]) {
  const chain = await ownedChain(userId, chainId);
  const preview = await prisma.playlistChainOptimizationPreview.findFirst({ where: { id: previewId, chainId, userId, status: "PREVIEW", expiresAt: { gt: new Date() } } });
  if (!preview) throw new Error("Optimization preview not found or expired.");
  if (preview.baseVersionNumber !== chain.versionCounter) throw new Error("The chain changed after this preview. Create a new optimization preview.");
  const suggestions = (preview.suggestionsJson as any[]).filter((suggestion) => selectedSuggestionIds.includes(suggestion.id));
  await createChainVersion(userId, chainId, "before_optimization_applied");
  await prisma.$transaction(async (tx) => {
    for (const suggestion of suggestions) if (suggestion.type === "REORDER_BOUNDARY") {
      await moveTrackToBoundary(tx, suggestion.fromPlaylistId, suggestion.fromTrackId, "end");
      await moveTrackToBoundary(tx, suggestion.toPlaylistId, suggestion.toTrackId, "start");
    } else if (suggestion.type === "ADD_SHARED_TRANSITION") await addSharedTransitionToOpening(tx, userId, suggestion);
    await tx.playlistChainOptimizationPreview.update({ where: { id: previewId }, data: { status: "APPLIED", appliedAt: new Date() } });
    await tx.playlistProgressionChain.update({ where: { id: chainId }, data: { lastOptimizedAt: new Date(), analysisJson: Prisma.JsonNull, qualityScore: null } });
  });
  const analysis = await analyzePlaylistChain(userId, chainId);
  console.info("[PlaylistChains] optimization applied", { userId, chainId, applied: suggestions.length });
  return { applied: suggestions.length, analysis };
}

export async function generateMasterJourney(userId: string, chainId: string, raw: unknown = {}) {
  const options = z.object({ removeDuplicateSharedTracks: z.boolean().default(true), preserveBoundaries: z.boolean().default(true), syncToPlex: z.boolean().default(false), name: z.string().trim().min(1).max(120).optional() }).parse(raw);
  const chain = await ownedChain(userId, chainId);
  if (!chain.members.length) throw new Error("The chain has no playlists.");
  const ordered = chain.members.flatMap((member) => member.playlist.tracks.map((track) => ({ ...track, sourcePlaylistId: member.playlistId })));
  const seen = new Set<string>();
  const tracks = ordered.filter((track) => {
    const key = track.trackId || track.plexTrackRatingKey || track.id;
    if (!options.removeDuplicateSharedTracks) return true;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const name = options.name || `${chain.name} — Master Journey`;
  const master = await prisma.$transaction(async (tx) => {
    const data = { userId, serverId: chain.members[0].playlist.serverId, plexPlaylistTitle: name, sourceType: "chain_master", engineVersion: "v2.2.3", filtersJson: json({ chainId, options }), trackCount: tracks.length, lastGeneratedAt: new Date() };
    const row = chain.masterGeneratedPlaylistId
      ? await tx.generatedPlaylist.update({ where: { id: chain.masterGeneratedPlaylistId }, data })
      : await tx.generatedPlaylist.create({ data });
    await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: row.id } });
    await tx.generatedPlaylistTrack.createMany({ data: tracks.map((track, index) => ({ generatedPlaylistId: row.id, trackId: track.trackId, plexTrackRatingKey: track.plexTrackRatingKey, position: index + 1, title: track.title, artist: track.artist, album: track.album, locked: track.locked, liked: track.liked, regenerationExcluded: track.regenerationExcluded, automationProtected: track.automationProtected, protectionReason: track.protectionReason })) });
    await tx.playlistProgressionChain.update({ where: { id: chainId }, data: { masterGeneratedPlaylistId: row.id, masterPlaylistEnabled: true } });
    return row;
  });
  let plexPlaylistId = master.plexPlaylistRatingKey;
  if (options.syncToPlex) {
    const trackIds = tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
    if (!trackIds.length) throw new Error("The master journey has no available tracks to sync.");
    if (master.plexPlaylistRatingKey) await syncGeneratedPlaylistToPlex(userId, master.id);
    else {
      const exported = await exportTracksToPlex({ userId, name, trackIds, rulesJson: "[]", optionsJson: JSON.stringify({ chainId, masterJourney: true }) });
      plexPlaylistId = exported.playlistId;
      await prisma.generatedPlaylist.update({ where: { id: master.id }, data: { plexPlaylistRatingKey: exported.playlistId, serverId: exported.serverId } });
    }
  }
  console.info("[PlaylistChains] master journey generated", { userId, chainId, trackCount: tracks.length, synced: options.syncToPlex });
  return { generatedPlaylistId: master.id, name, trackCount: tracks.length, removedDuplicates: ordered.length - tracks.length, plexPlaylistId, sourcePlaylistsModified: false };
}

export async function syncMasterJourney(userId: string, chainId: string) {
  const chain = await ownedChain(userId, chainId);
  if (!chain.masterGeneratedPlaylistId) throw new Error("Generate the master journey before syncing it.");
  if (!chain.masterGeneratedPlaylist?.plexPlaylistRatingKey) return generateMasterJourney(userId, chainId, { syncToPlex: true });
  await syncGeneratedPlaylistToPlex(userId, chain.masterGeneratedPlaylistId);
  return { synced: true, plexPlaylistId: chain.masterGeneratedPlaylist.plexPlaylistRatingKey };
}

export async function listChainVersions(userId: string, chainId: string, input: { page?: number; pageSize?: number } = {}) {
  await ownedChain(userId, chainId);
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(50, Math.max(1, input.pageSize || 20));
  const [items, total] = await Promise.all([
    prisma.playlistChainVersion.findMany({ where: { chainId }, orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, reason: true, createdAt: true, createdByUserId: true }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.playlistChainVersion.count({ where: { chainId } }),
  ]);
  return { items, page, pageSize, total, pages: Math.ceil(total / pageSize) };
}

export async function restoreChainVersion(userId: string, chainId: string, versionId: string) {
  await ownedChain(userId, chainId);
  const version = await prisma.playlistChainVersion.findFirst({ where: { id: versionId, chainId } });
  if (!version) throw new Error("Chain version not found.");
  const snapshot = version.snapshotJson as any;
  const playlistIds = snapshot.members.map((member: any) => member.playlistId);
  const available = await prisma.generatedPlaylist.findMany({ where: { id: { in: playlistIds }, userId }, select: { id: true } });
  const availableIds = new Set(available.map((playlist) => playlist.id));
  const members = snapshot.members.filter((member: any) => availableIds.has(member.playlistId));
  if (members.length < 2) throw new Error("This version cannot be restored because fewer than two referenced playlists still exist.");
  const [roles, transitionTracks] = await Promise.all([
    prisma.playlistRoleDefinition.findMany({ where: { id: { in: members.map((member: any) => member.roleDefinitionId).filter(Boolean) } }, select: { id: true } }),
    prisma.track.findMany({ where: { id: { in: (snapshot.handoffs || []).flatMap((handoff: any) => (handoff.transitionTracks || []).map((track: any) => track.trackId)) }, syncStatus: "active", deletedAt: null }, select: { id: true } }),
  ]);
  const availableRoleIds = new Set(roles.map((role) => role.id)); const availableTrackIds = new Set(transitionTracks.map((track) => track.id)); const restoredMemberIds = new Set(members.map((member: any) => member.id));
  await createChainVersion(userId, chainId, "before_version_restore");
  await prisma.$transaction(async (tx) => {
    await tx.playlistProgressionMember.deleteMany({ where: { chainId } });
    await tx.playlistProgressionChain.update({ where: { id: chainId }, data: { ...snapshot.chain, settingsJson: json(snapshot.chain.settingsJson || {}), analysisJson: Prisma.JsonNull, qualityScore: null, archivedAt: snapshot.chain.status === "ARCHIVED" ? new Date() : null } });
    await tx.playlistProgressionMember.createMany({ data: members.map((member: any, index: number) => ({ ...member, chainId, sequencePosition: index + 1, roleDefinitionId: availableRoleIds.has(member.roleDefinitionId) ? member.roleDefinitionId : null, roleOverrideJson: member.roleOverrideJson ? json(member.roleOverrideJson) : undefined })) });
    for (const handoff of (snapshot.handoffs || []).filter((item: any) => restoredMemberIds.has(item.fromMemberId) && restoredMemberIds.has(item.toMemberId))) {
      await tx.playlistChainHandoff.create({ data: { chainId, fromMemberId: handoff.fromMemberId, toMemberId: handoff.toMemberId, energyMode: handoff.energyMode, bpmMode: handoff.bpmMode, moodMode: handoff.moodMode, sharedTrackMode: handoff.sharedTrackMode, handoffSettingsJson: json(handoff.handoffSettingsJson || {}), locked: Boolean(handoff.locked), transitionTracks: { create: (handoff.transitionTracks || []).filter((track: any) => availableTrackIds.has(track.trackId)).map((track: any) => ({ trackId: track.trackId, placementMode: track.placementMode, score: track.score, locked: Boolean(track.locked), explanationJson: json(track.explanationJson || {}) })) } } });
    }
  });
  await reconcileHandoffs(chainId);
  console.info("[PlaylistChains] chain restored", { userId, chainId, versionId, skippedPlaylists: playlistIds.length - members.length });
  return { chain: await getPlaylistChain(userId, chainId), warnings: playlistIds.length === members.length ? [] : [`${playlistIds.length - members.length} deleted playlist reference(s) were skipped.`] };
}

export async function getChainSettings(userId: string) {
  return prisma.playlistChainSetting.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function updateChainSettings(userId: string, raw: unknown) {
  const input = chainSettingsSchema.parse(raw);
  return prisma.playlistChainSetting.upsert({ where: { userId }, create: { userId, ...input }, update: input });
}

export async function queueAffectedChainMaintenance(userId: string, playlistId: string) {
  const settings = await getChainSettings(userId);
  if (!settings.chainsEnabled || !settings.automaticallyAnalyzeUpdatedChains) return { queued: 0 };
  const memberships = await prisma.playlistProgressionMember.findMany({ where: { playlistId, chain: { userId, guidanceEnabled: true, archivedAt: null } }, select: { chainId: true, chain: { select: { masterPlaylistEnabled: true, settingsJson: true } } }, distinct: ["chainId"] });
  if (!memberships.length) return { queued: 0 };
  const { queueChainAnalysis } = await import("./jobs");
  for (const membership of memberships) {
    await queueChainAnalysis(userId, membership.chainId).catch((error) => console.warn("[PlaylistChains] automatic chain analysis could not be queued", { userId, playlistId, chainId: membership.chainId, error: error instanceof Error ? error.message : String(error) }));
    if (membership.chain.masterPlaylistEnabled && Boolean((membership.chain.settingsJson as any)?.autoRefreshMasterAfterChildChange)) await generateMasterJourney(userId, membership.chainId, { removeDuplicateSharedTracks: true, preserveBoundaries: true, syncToPlex: false }).catch((error) => console.warn("[PlaylistChains] automatic master refresh failed", { chainId: membership.chainId, error: error instanceof Error ? error.message : String(error) }));
  }
  return { queued: memberships.length };
}
