import type { RoleGuidance } from "./types";

export type BuiltInRolePreset = RoleGuidance & { id: string; key: string; name: string; description: string; expectedNextRoles: string[] };

export const BUILT_IN_ROLE_PRESETS: BuiltInRolePreset[] = [
  { id: "role-intro", key: "intro", name: "Intro", description: "A smooth arrival that prepares the next playlist.", energyStart: 0.25, energyEnd: 0.5, bpmMin: 70, bpmMax: 105, discoveryLevel: 0.25, transitionMode: "VERY_SMOOTH", moodDirection: "BUILD", settings: { endingBehavior: "PREPARE_NEXT", artistVariety: 0.7, repeatTolerance: 0.15 }, expectedNextRoles: ["warm-up", "main", "discovery"] },
  { id: "role-warm-up", key: "warm-up", name: "Warm-up", description: "A gradual build into sustained activity.", energyStart: 0.35, energyEnd: 0.65, bpmMin: 80, bpmMax: 115, discoveryLevel: 0.3, transitionMode: "SMOOTH", moodDirection: "BUILD", settings: { endingBehavior: "PREPARE_NEXT", artistVariety: 0.7, repeatTolerance: 0.15 }, expectedNextRoles: ["main", "peak-energy"] },
  { id: "role-main", key: "main", name: "Main", description: "The central experience with balanced familiarity and discovery.", energyStart: 0.6, energyEnd: 0.82, bpmMin: 100, bpmMax: 128, discoveryLevel: 0.5, transitionMode: "SMOOTH", moodDirection: "MAINTAIN", settings: { endingBehavior: "MAINTAIN_MOMENTUM", artistVariety: 0.65, repeatTolerance: 0.2 }, expectedNextRoles: ["peak-energy", "recovery", "after-hours"] },
  { id: "role-peak-energy", key: "peak-energy", name: "Peak Energy", description: "High-intensity familiar anchors with strong continuity.", energyStart: 0.82, energyEnd: 0.95, bpmMin: 118, bpmMax: 145, discoveryLevel: 0.3, transitionMode: "STRONG_CONTINUITY", moodDirection: "PEAK", settings: { endingBehavior: "CONTROLLED_REDUCTION", artistVariety: 0.55, repeatTolerance: 0.25 }, expectedNextRoles: ["recovery", "cooldown", "after-hours"] },
  { id: "role-recovery", key: "recovery", name: "Recovery", description: "A gentle reduction that retains enough momentum for what follows.", energyStart: 0.65, energyEnd: 0.42, bpmMin: 90, bpmMax: 118, discoveryLevel: 0.5, transitionMode: "GENTLE", moodDirection: "RELEASE", settings: { endingBehavior: "PREPARE_NEXT", artistVariety: 0.7, repeatTolerance: 0.15 }, expectedNextRoles: ["cooldown", "warm-up", "after-hours"] },
  { id: "role-cooldown", key: "cooldown", name: "Cooldown", description: "A soft, low-energy conclusion.", energyStart: 0.42, energyEnd: 0.2, bpmMin: 65, bpmMax: 100, discoveryLevel: 0.2, transitionMode: "VERY_SMOOTH", moodDirection: "CALM", settings: { endingBehavior: "SOFT_CONCLUSION", artistVariety: 0.65, repeatTolerance: 0.1 }, expectedNextRoles: ["archive"] },
  { id: "role-discovery", key: "discovery", name: "Discovery", description: "A flexible showcase for unfamiliar tracks supported by familiar anchors.", energyStart: 0.45, energyEnd: 0.65, bpmMin: 70, bpmMax: 150, discoveryLevel: 0.85, transitionMode: "MODERATELY_FLEXIBLE", moodDirection: "FLEXIBLE", settings: { endingBehavior: "PREPARE_NEXT", familiarityAnchors: true, artistVariety: 0.9, repeatTolerance: 0.05 }, expectedNextRoles: ["main", "recovery", "cooldown"] },
  { id: "role-intermission", key: "intermission", name: "Intermission", description: "A short reset between major sections of a journey.", energyStart: 0.4, energyEnd: 0.35, bpmMin: 65, bpmMax: 110, discoveryLevel: 0.35, transitionMode: "GENTLE", moodDirection: "RESET", settings: { endingBehavior: "PREPARE_NEXT", artistVariety: 0.7, repeatTolerance: 0.1 }, expectedNextRoles: ["warm-up", "main", "discovery"] },
  { id: "role-after-hours", key: "after-hours", name: "After-Hours", description: "A late-session continuation with a looser, deeper character.", energyStart: 0.58, energyEnd: 0.38, bpmMin: 80, bpmMax: 120, discoveryLevel: 0.6, transitionMode: "SMOOTH", moodDirection: "DARKER", settings: { endingBehavior: "SOFT_CONCLUSION", artistVariety: 0.8, repeatTolerance: 0.1 }, expectedNextRoles: ["cooldown", "archive"] },
  { id: "role-archive", key: "archive", name: "Archive", description: "A preserved historical playlist excluded from automatic changes.", energyStart: null, energyEnd: null, bpmMin: null, bpmMax: null, discoveryLevel: 0, transitionMode: "NONE", moodDirection: "NONE", settings: { generationEnabled: false, automaticChanges: false, historicalPreservation: true }, expectedNextRoles: [] },
  { id: "role-custom", key: "custom", name: "Custom", description: "A user-named role with fully editable guidance.", energyStart: null, energyEnd: null, bpmMin: null, bpmMax: null, discoveryLevel: 0.5, transitionMode: "SMOOTH", moodDirection: "FLEXIBLE", settings: { endingBehavior: "NO_PREFERENCE", artistVariety: 0.7, repeatTolerance: 0.15 }, expectedNextRoles: [] },
];

export function resolveRoleGuidance(role: Partial<RoleGuidance> | null | undefined, overrides: Record<string, unknown> = {}): RoleGuidance {
  const override = (key: keyof RoleGuidance, fallback: unknown) => Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
  return {
    energyStart: override("energyStart", role?.energyStart ?? null) as number | null,
    energyEnd: override("energyEnd", role?.energyEnd ?? null) as number | null,
    bpmMin: override("bpmMin", role?.bpmMin ?? null) as number | null,
    bpmMax: override("bpmMax", role?.bpmMax ?? null) as number | null,
    discoveryLevel: override("discoveryLevel", role?.discoveryLevel ?? null) as number | null,
    transitionMode: override("transitionMode", role?.transitionMode ?? null) as string | null,
    moodDirection: override("moodDirection", role?.moodDirection ?? null) as string | null,
    settings: { ...(role?.settings || {}), ...((overrides.settings as Record<string, unknown> | undefined) || {}) },
  };
}

export function roleGuidanceDifferences(role: RoleGuidance, resolved: RoleGuidance) {
  const keys: Array<keyof Omit<RoleGuidance, "settings">> = ["energyStart", "energyEnd", "bpmMin", "bpmMax", "discoveryLevel", "transitionMode", "moodDirection"];
  return keys.filter((key) => role[key] !== resolved[key]);
}
