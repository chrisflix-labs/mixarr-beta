import { z } from "zod";
import { HOUSEHOLD_BALANCE_MODES } from "./core";

export const memberTypes = ["OWNER", "MEMBER", "CHILD", "GUEST"] as const;
export const familyRules = ["ALLOW", "BLOCK", "STRICTEST_PROFILE", "ADMINISTRATOR_OVERRIDE"] as const;
export const approvalModes = ["DISABLED", "FIXED", "MAJORITY", "UNANIMOUS", "ADMINISTRATOR_ONLY", "CONFLICT_SEVERITY"] as const;

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  avatar: z.string().trim().max(500).optional().nullable(),
  defaultBalanceMode: z.enum(HOUSEHOLD_BALANCE_MODES).default("BALANCED_HOUSEHOLD"),
  defaultFamilyRule: z.enum(familyRules).default("STRICTEST_PROFILE"),
  defaultMaximumInfluence: z.coerce.number().min(0.05).max(1).default(0.5),
});

export const updateHouseholdSchema = createHouseholdSchema.partial().extend({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const memberInputSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(120).optional(),
  memberType: z.enum(memberTypes).default("MEMBER"),
  influenceWeight: z.coerce.number().min(0).max(100).default(1),
  isActive: z.boolean().default(true),
  votingEligible: z.boolean().default(true),
  approvalEligible: z.boolean().default(true),
  familyFriendlyRestriction: z.enum(["INHERIT", "ALLOW", "BLOCK"]).default("INHERIT"),
});

export const memberUpdateSchema = memberInputSchema.omit({ userId: true }).partial().extend({
  temporarilyExcluded: z.boolean().optional(),
  exclusionExpiresAt: z.coerce.date().optional().nullable(),
});

export const guestInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  isReusable: z.boolean().default(false),
  expiresAt: z.coerce.date().optional().nullable(),
  influenceWeight: z.coerce.number().min(0).max(100).default(1),
  votingEligible: z.boolean().default(true),
  approvalEligible: z.boolean().default(false),
  explicitContentRestriction: z.enum(["INHERIT", "ALLOW", "BLOCK"]).default("INHERIT"),
  preferences: z.object({
    genres: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    moods: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    artists: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    likedTrackIds: z.array(z.string()).max(1000).default([]),
    dislikedTrackIds: z.array(z.string()).max(1000).default([]),
  }).optional(),
}).superRefine((value, context) => {
  if (value.expiresAt && value.expiresAt.getTime() <= Date.now()) context.addIssue({ code: "custom", path: ["expiresAt"], message: "Guest expiration must be in the future." });
});

export const guestUpdateSchema = guestInputSchema.innerType().partial().extend({ isActive: z.boolean().optional() });

export const householdPreferenceSchema = z.object({
  actorGuestId: z.string().uuid().optional().nullable(),
  scope: z.enum(["HOUSEHOLD", "PLAYLIST", "RECIPE", "GLOBAL"]).default("HOUSEHOLD"),
  playlistId: z.string().uuid().optional().nullable(),
  targetType: z.enum(["TRACK", "ARTIST", "GENRE", "MOOD", "ENERGY", "DISCOVERY", "POPULARITY", "PLAYLIST_STRUCTURE"]),
  targetId: z.string().trim().min(1).max(200),
  state: z.enum(["LIKE", "DISLIKE", "NEUTRAL", "SHARED_LIKE", "SHARED_DISLIKE", "HARD_DISLIKE", "MORE_LIKE_THIS", "LESS_LIKE_THIS", "GOOD_FOR_EVERYONE", "GREAT_SHARED_PICK", "NOT_FAMILY_FRIENDLY"]),
  strength: z.coerce.number().min(0).max(10).default(1),
  isHardRule: z.boolean().default(false),
  expiresAt: z.coerce.date().optional().nullable(),
});

export const householdPlaylistDraftSchema = z.object({
  householdId: z.string().uuid(),
  balanceMode: z.enum(HOUSEHOLD_BALANCE_MODES).default("BALANCED_HOUSEHOLD"),
  primaryMemberId: z.string().uuid().optional().nullable(),
  participantMemberIds: z.array(z.string().uuid()).max(25).default([]),
  participantGuestIds: z.array(z.string().uuid()).max(25).default([]),
  influenceOverrides: z.record(z.string(), z.coerce.number().min(0).max(100)).default({}),
  sharedFavoritesWeight: z.coerce.number().min(0).max(0.9).default(0.15),
  sharedFavoritesEnabled: z.boolean().default(true),
  maximumIndividualInfluence: z.coerce.number().min(0.05).max(1).default(0.5),
  maximumTracksPerMemberPercent: z.coerce.number().min(0.05).max(1).default(0.5),
  maximumConsecutiveMemberTracks: z.coerce.number().int().min(1).max(20).default(3),
  requireEveryParticipant: z.boolean().default(true),
  redistributeUnusedInfluence: z.boolean().default(true),
  administratorOverride: z.boolean().default(false),
  familyRule: z.enum(familyRules).default("STRICTEST_PROFILE"),
  unknownRatingRule: z.enum(["ALLOW", "BLOCK"]).default("BLOCK"),
  preferCleanVersions: z.boolean().default(true),
  partyModeEnabled: z.boolean().default(false),
  partySettings: z.object({
    energyLevel: z.coerce.number().min(0).max(1).default(0.75),
    discovery: z.coerce.number().min(0).max(1).default(0.25),
    guestInfluence: z.coerce.number().min(0).max(1).default(0.25),
    explicitContentAllowed: z.boolean().default(false),
    autoRegenerationThreshold: z.coerce.number().int().min(1).max(100).default(10),
  }).default({}),
  votingEnabled: z.boolean().default(false),
  liveFeedbackEnabled: z.boolean().default(false),
  approvalMode: z.enum(approvalModes).default("DISABLED"),
  fixedApprovalCount: z.coerce.number().int().min(1).max(25).optional().nullable(),
  approvalConflictSeverity: z.coerce.number().int().min(1).max(5).optional().nullable(),
  maximumArtistRepetition: z.coerce.number().int().min(1).max(50).default(3),
  maximumGenreConcentration: z.coerce.number().min(0.05).max(1).default(0.6),
}).superRefine((value, context) => {
  if (!value.participantMemberIds.length && !value.participantGuestIds.length) context.addIssue({ code: "custom", path: ["participantMemberIds"], message: "Select at least one household participant." });
  if (value.approvalMode === "FIXED" && !value.fixedApprovalCount) context.addIssue({ code: "custom", path: ["fixedApprovalCount"], message: "A fixed approval count is required." });
  if (value.approvalMode === "CONFLICT_SEVERITY" && !value.approvalConflictSeverity) context.addIssue({ code: "custom", path: ["approvalConflictSeverity"], message: "A conflict severity threshold is required." });
});

export const voteSchema = z.object({
  playlistVersion: z.coerce.number().int().min(1).default(1),
  targetType: z.enum(["PLAYLIST", "TRACK", "REPLACEMENT"]).default("PLAYLIST"),
  targetId: z.string().trim().min(1).max(200).default("PLAYLIST"),
  voteType: z.enum(["APPROVE", "DISAPPROVE", "NEUTRAL", "LIKE", "DISLIKE"]),
  guestId: z.string().uuid().optional().nullable(),
});

export const approvalSchema = z.object({
  playlistVersion: z.coerce.number().int().min(1).default(1),
  status: z.enum(["APPROVED", "REVOKED"]).default("APPROVED"),
  guestId: z.string().uuid().optional().nullable(),
});

