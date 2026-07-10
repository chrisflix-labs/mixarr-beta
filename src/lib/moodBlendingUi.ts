export type MoodBlendMode = "off" | "smooth_transition" | "strict_matching" | "mixed_mood";

export type MoodBlendSelectionState = {
  moodBlendMode: MoodBlendMode;
  selectedMoodPath: string[];
  allowedMoods: string[];
};

export function activeMoodSelection(settings: MoodBlendSelectionState) {
  return settings.moodBlendMode === "mixed_mood" ? settings.allowedMoods : settings.selectedMoodPath;
}

export function moodBlendValidationMessage(settings: MoodBlendSelectionState) {
  const activeMoods = activeMoodSelection(settings);
  if (settings.moodBlendMode === "off") return "";
  if (settings.moodBlendMode === "smooth_transition" && activeMoods.length < 2) {
    return "Smooth Transition needs at least two moods to define the playlist journey.";
  }
  if (settings.moodBlendMode === "strict_matching" && activeMoods.length < 1) {
    return "Strict Matching needs at least one target mood.";
  }
  if (settings.moodBlendMode === "mixed_mood" && activeMoods.length < 1) {
    return "Mixed Mood needs at least one anchor mood.";
  }
  return "";
}

export function pruneUnavailableMoodSelections<T extends MoodBlendSelectionState>(
  settings: T,
  availableMoodNames: string[],
) {
  const available = new Set(availableMoodNames.map((mood) => mood.trim().toLowerCase()).filter(Boolean));
  if (available.size === 0) return { settings, removed: [] as string[] };

  const prune = (moods: string[]) => {
    const kept: string[] = [];
    const removed: string[] = [];
    for (const mood of moods) {
      if (available.has(mood.trim().toLowerCase())) kept.push(mood);
      else removed.push(mood);
    }
    return { kept, removed };
  };

  const path = prune(settings.selectedMoodPath);
  const allowed = prune(settings.allowedMoods);
  return {
    settings: {
      ...settings,
      selectedMoodPath: path.kept,
      allowedMoods: allowed.kept,
    },
    removed: [...path.removed, ...allowed.removed],
  };
}
